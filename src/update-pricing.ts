// update-pricing: scrape ollama.com/pricing, extract the rate cards with
// glm-5.3-flash (JSON mode + zod validation), then refresh cost in
// catalog.json and publish pricing.json. DOM row counts are ground truth
// for completeness; any coverage problem aborts before writing.
// Peak pricing (a subset of models, higher rates 12:00-18:00 UTC Mon-Fri)
// is stored under x_ollama: `cost` always means the standard rate.
import { extractPricingTables, fetchPricingHtml, PRICING_URL } from "./sources/pricing-page.ts";
import { extractJson } from "./extract/ai.ts";
import { RateCardExtractionSchema } from "./catalog/schema.ts";
import { resolveRates } from "./catalog/resolve-rates.ts";
import { applyCosts, buildPricingDoc, loadCatalog, publishCatalog, publishPricing, PRICING_PATH } from "./catalog/assemble.ts";
import { PricingDocSchema, type PricingDoc } from "./catalog/schema.ts";
import { stableStringify } from "./lib/artifacts.ts";

const { standard, peak, peakWindow } = extractPricingTables(await fetchPricingHtml());
console.log(
  `pricing tables extracted: ${standard.rowCount} standard rows` +
    (peak ? `, ${peak.rowCount} peak rows` : ", no peak table"),
);

const extraction = await extractJson(
  RateCardExtractionSchema,
  [
    `You extract Ollama's model pricing rate cards from markdown tables.`,
    `TABLE 1 is the standard rate card with exactly ${standard.rowCount} rate rows; "rates" must contain exactly those ${standard.rowCount} rows in order.`,
    peak
      ? `TABLE 2 is the peak-pricing rate card with exactly ${peak.rowCount} rate rows; "peak_rates" must contain exactly those ${peak.rowCount} rows in order.`
      : `There is no peak-pricing table; "peak_rates" must be an empty array.`,
    `The "Model" column holds the full model id, including any tag suffix (e.g. 'gpt-oss:120b' — never drop the tag). Prices are US dollars per million tokens; strip the $ sign and report plain numbers. A '-' cell means null (no rate).`,
  ].join(" "),
  [TABLE_LABEL("Standard rate card", standard), peak ? TABLE_LABEL("Peak pricing", peak) : ""]
    .filter(Boolean)
    .join("\n\n"),
);
if (extraction.rates.length !== standard.rowCount)
  throw new Error(
    `standard rate extraction incomplete: got ${extraction.rates.length}, table has ${standard.rowCount} rows`,
  );
if (extraction.peak_rates.length !== (peak?.rowCount ?? 0))
  throw new Error(
    `peak rate extraction incomplete: got ${extraction.peak_rates.length}, table has ${peak?.rowCount ?? 0} rows`,
  );
console.log(
  `extracted ${extraction.rates.length} standard rates, ${extraction.peak_rates.length} peak rates`,
);

function TABLE_LABEL(label: string, table: { markdown: string }): string {
  return `## ${label}\n${table.markdown}`;
}

const catalog = await loadCatalog();
if (!catalog) throw new Error("catalog.json missing; run update-catalog first");
const models = new Map(Object.entries(catalog.provider.models));

const { costById, problems: standardProblems } = resolveRates(extraction.rates, models);
const { costById: peakCostById, problems: peakProblems } = resolveRates(
  extraction.peak_rates,
  models,
  false,
);
const problems = [...standardProblems, ...peakProblems];
if (problems.length > 0) {
  console.error(`x pricing coverage problems (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

// A refresh with identical rates is not a change: skip the write instead of
// churning generated_at (the old repo's "asOf changes alone are NOT a diff"
// rule, applied to the publish decision).
const previousPricing = await (async () => {
  const file = Bun.file(PRICING_PATH);
  if (!(await file.exists())) return undefined;
  return PricingDocSchema.parse(await file.json());
})();
const costSignature = (doc: PricingDoc | undefined) =>
  doc ? stableStringify({ models: doc.models, x_ollama: doc.x_ollama ?? null }) : "";
const nextSignature = stableStringify({
  models: Object.fromEntries([...costById.entries()].sort(([a], [b]) => a.localeCompare(b))),
  x_ollama:
    peak && peakWindow
      ? {
          peak_window: peakWindow,
          models: Object.fromEntries(
            [...peakCostById.entries()].sort(([a], [b]) => a.localeCompare(b)),
          ),
        }
      : null,
});
if (previousPricing && costSignature(previousPricing) === nextSignature) {
  console.log("rates unchanged since last run; pricing.json not touched");
  // The catalog may still lag behind (a rebuild between runs can drop
  // cost fields, e.g. restored peak rates): repair the merge-back without
  // churning the pricing artifact.
  const repaired = applyCosts(catalog, costById, peakCostById);
  if (stableStringify(repaired) !== stableStringify(catalog)) {
    await publishCatalog(repaired);
    console.log("catalog.json cost fields refreshed to match the current rates");
  }
  process.exit(0);
}

await publishCatalog(applyCosts(catalog, costById, peakCostById));
await publishPricing(
  peak && peakWindow
    ? buildPricingDoc(costById, { window: peakWindow, costById: peakCostById })
    : buildPricingDoc(costById),
);
console.log(
  `published pricing.json and refreshed cost in catalog.json (${costById.size} standard, ${peakCostById.size} peak, source: ${PRICING_URL})`,
);