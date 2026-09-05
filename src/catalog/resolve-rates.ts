// Rate-card → catalog resolution, ported from the original update-pricing.
// Rate names come from the table's link text (family-level ids, Ollama's
// rate card only sometimes lists tags), so: exact id match first, otherwise
// unique family match. Ambiguous families throw, unknown rates are problems,
// and — for the standard table — uncovered catalog models are problems.
// Any problem aborts the update. Nothing is ever silently dropped.
import { familyOf } from "../lib/ids.ts";
import type { Cost, Model, RateRow } from "./schema.ts";

export type RateResolution = {
  costById: Map<string, Cost>;
  problems: string[];
};

export function resolveRateId(rateName: string, catalogIds: string[]): string | undefined {
  if (catalogIds.includes(rateName)) return rateName;
  const family = familyOf(rateName);
  const matches = catalogIds.filter((id) => familyOf(id) === family);
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1)
    throw new Error(
      `pricing page: rate "${rateName}" is ambiguous — catalog families ${family}: ${matches.join(", ")}`,
    );
  return undefined;
}

export function resolveRates(
  rates: RateRow[],
  models: Map<string, Model>,
  // The standard table must price every catalog model; the peak table only
  // covers the subset Ollama peak-prices, so uncovered models are normal.
  requireAll = true,
): RateResolution {
  const catalogIds = [...models.keys()];
  const costById = new Map<string, Cost>();
  const problems: string[] = [];

  for (const rate of rates) {
    const id = resolveRateId(rate.model, catalogIds);
    if (id === undefined) {
      problems.push(
        `rate card lists "${rate.model}", which is not in the catalog (typo or retired model? run update-catalog, then update-pricing)`,
      );
      continue;
    }
    costById.set(id, {
      input: rate.input,
      ...(rate.cached_input !== null ? { cache_read: rate.cached_input } : {}),
      output: rate.output,
    });
  }

  if (requireAll)
    for (const id of catalogIds)
      if (!costById.has(id))
        problems.push(`catalog model "${id}" has no rate on the pricing page`);

  return { costById, problems };
}