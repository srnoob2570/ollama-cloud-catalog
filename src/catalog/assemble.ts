// Artifact assembly: build both documents from sources + previous state,
// validate against the zod schemas, and publish atomically. Cost always
// survives catalog rebuilds (pricing is a separate flow) and pricing updates
// never touch specs — the two flows only share the cost fields.
import { CatalogDocSchema, PricingDocSchema, type CatalogDoc, type Cost, type Model, type PricingDoc } from "./schema.ts";
import { stableStringify, writeAtomic } from "../lib/artifacts.ts";

export const CATALOG_PATH = "catalog.json";
export const PRICING_PATH = "pricing.json";

const SCHEMA_BASE =
  "https://raw.githubusercontent.com/srnoob2570/ollama-cloud-catalog/main/schemas";

export type CatalogSources = {
  modelsHash: string;
  specs: Model[]; // one per listed id, in any order
  costs: Map<string, Cost>; // from previous artifacts, keyed by model id
  peakCosts?: Map<string, Cost>; // models the rate card peak-prices
};

export function buildCatalogDoc(sources: CatalogSources): CatalogDoc {
  const models = Object.fromEntries(
    sources.specs.map((spec) => {
      const cost = sources.costs.get(spec.id);
      const peakCost = sources.peakCosts?.get(spec.id);
      return [
        spec.id,
        {
          ...spec,
          ...(cost ? { cost } : {}),
          x_ollama: {
            ...spec.x_ollama,
            ...(peakCost ? { peak_cost: peakCost } : {}),
          },
        },
      ];
    }),
  );
  const doc = {
    $schema: `${SCHEMA_BASE}/catalog.schema.json`,
    provider: {
      id: "ollama-cloud",
      name: "Ollama Cloud",
      env: ["OLLAMA_API_KEY"],
      npm: "@ai-sdk/openai-compatible",
      doc: "https://ollama.com/docs/cloud",
      models,
    },
    x_ollama: {
      generated_at: new Date().toISOString(),
      models_hash: sources.modelsHash,
      sources: {
        models: "https://ollama.com/v1/models",
        show: "https://ollama.com/api/show",
      },
    },
  };
  return CatalogDocSchema.parse(doc);
}

export function buildPricingDoc(
  costById: Map<string, Cost>,
  peak?: { window: string; costById: Map<string, Cost> },
): PricingDoc {
  const doc = {
    $schema: `${SCHEMA_BASE}/pricing.schema.json`,
    provider: "ollama-cloud",
    generated_at: new Date().toISOString(),
    source: "https://ollama.com/pricing",
    models: Object.fromEntries(
      [...costById.entries()].map(([id, cost]) => [id, cost]),
    ),
    ...(peak
      ? {
          x_ollama: {
            peak_window: peak.window,
            models: Object.fromEntries(
              [...peak.costById.entries()].map(([id, cost]) => [id, cost]),
            ),
          },
        }
      : {}),
  };
  return PricingDocSchema.parse(doc);
}

// The pricing refresh decision. Identical rates are not a change: skip the
// write instead of churning generated_at (the old repo's "asOf changes alone
// are NOT a diff" rule, applied to the publish decision). The signature
// covers only the rate-bearing fields; $schema/provider/generated_at/source
// are volatile and must never trigger a publish. When the rates match the
// previous pricing but the catalog lags behind (a rebuild between runs can
// drop cost fields, e.g. restored peak rates), the merge-back is repaired
// without churning the pricing artifact.
export type RefreshDecision =
  | { action: "skip" }
  | { action: "repair"; catalog: CatalogDoc }
  | { action: "publish"; catalog: CatalogDoc; pricing: PricingDoc };

export function refreshDecision(
  previousPricing: PricingDoc | undefined,
  catalog: CatalogDoc,
  costById: Map<string, Cost>,
  peakCostById: Map<string, Cost>,
  peak?: { window: string },
): RefreshDecision {
  const next = buildPricingDoc(
    costById,
    peak ? { window: peak.window, costById: peakCostById } : undefined,
  );
  const signature = (doc: PricingDoc) =>
    stableStringify({ models: doc.models, x_ollama: doc.x_ollama ?? null });
  if (previousPricing && signature(previousPricing) === signature(next)) {
    const repaired = applyCosts(catalog, costById, peakCostById);
    if (stableStringify(repaired) !== stableStringify(catalog))
      return { action: "repair", catalog: repaired };
    return { action: "skip" };
  }
  return {
    action: "publish",
    catalog: applyCosts(catalog, costById, peakCostById),
    pricing: next,
  };
}

// Merge-back helper for update-pricing: refresh cost fields in the catalog
// doc in place (specs, hash and generation stamp untouched). Peak rates ride
// under the per-model x_ollama extension. The cost map only refreshes
// (standard cost is never removed); the peak map is authoritative — a model
// the rate card no longer peak-prices loses its peak_cost.
export function applyCosts(
  catalog: CatalogDoc,
  costById: Map<string, Cost>,
  peakCostById: Map<string, Cost>,
): CatalogDoc {
  const models = Object.fromEntries(
    Object.entries(catalog.provider.models).map(([id, model]) => {
      const cost = costById.get(id);
      const peakCost = peakCostById.get(id);
      const x_ollama = { ...model.x_ollama };
      if (peakCost) x_ollama.peak_cost = peakCost;
      else delete x_ollama.peak_cost;
      return [
        id,
        {
          ...model,
          ...(cost ? { cost } : {}),
          x_ollama,
        },
      ];
    }),
  );
  return CatalogDocSchema.parse({ ...catalog, provider: { ...catalog.provider, models } });
}

export async function publishCatalog(doc: CatalogDoc) {
  await writeAtomic(CATALOG_PATH, stableStringify(doc));
}

export async function publishPricing(doc: PricingDoc) {
  await writeAtomic(PRICING_PATH, stableStringify(doc));
}

export async function loadCatalog(): Promise<CatalogDoc | undefined> {
  const file = Bun.file(CATALOG_PATH);
  if (!(await file.exists())) return undefined;
  return CatalogDocSchema.parse(await file.json());
}

// Mirror of loadCatalog. A pricing.json that no longer parses aborts the run:
// a corrupt rate card means manual intervention, not silent re-publication.
export async function loadPreviousPricing(): Promise<PricingDoc | undefined> {
  const file = Bun.file(PRICING_PATH);
  if (!(await file.exists())) return undefined;
  return PricingDocSchema.parse(await file.json());
}

export function previousSpecs(catalog: CatalogDoc | undefined): Map<string, Model> {
  return new Map(Object.entries(catalog?.provider.models ?? {}));
}

export function previousCosts(catalog: CatalogDoc | undefined): Map<string, Cost> {
  const costs = new Map<string, Cost>();
  for (const [id, model] of Object.entries(catalog?.provider.models ?? {}))
    if (model.cost) costs.set(id, model.cost);
  return costs;
}

// Peak rates are part of the pricing flow's output too — they must survive
// catalog rebuilds exactly like the standard cost, or every hash-gated
// update would silently strip them until the next weekly pricing run.
export function previousPeakCosts(catalog: CatalogDoc | undefined): Map<string, Cost> {
  const costs = new Map<string, Cost>();
  for (const [id, model] of Object.entries(catalog?.provider.models ?? {}))
    if (model.x_ollama.peak_cost) costs.set(id, model.x_ollama.peak_cost);
  return costs;
}