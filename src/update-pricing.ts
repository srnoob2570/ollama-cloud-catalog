// update-pricing: scrape ollama.com/pricing, extract the rate cards with
// glm-5.3-flash (JSON mode + zod validation), then refresh cost in
// catalog.json and publish pricing.json. DOM row counts are ground truth
// for completeness; any coverage problem aborts before writing.
// Peak pricing (a subset of models, higher rates 12:00-18:00 UTC Mon-Fri)
// is stored under x_ollama: `cost` always means the standard rate.
import { extractPricingTables, fetchPricingHtml, PRICING_URL } from "./sources/pricing-page.ts";
import { extractRates } from "./catalog/extract-rates.ts";
import { resolveRates } from "./catalog/resolve-rates.ts";
import { loadPreviousPricing, loadCatalog, publishCatalog, publishPricing, refreshDecision } from "./catalog/assemble.ts";

const { standard, peak, peakWindow } = extractPricingTables(await fetchPricingHtml());
console.log(
  `pricing tables extracted: ${standard.rowCount} standard rows` +
    (peak ? `, ${peak.rowCount} peak rows` : ", no peak table"),
);

const extraction = await extractRates(standard, peak);
console.log(
  `extracted ${extraction.rates.length} standard rates, ${extraction.peak_rates.length} peak rates`,
);

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

// A refresh with identical rates is not a change: refreshDecision skips the
// write, repairs a lagging catalog, or publishes both artifacts.
const decision = refreshDecision(
  await loadPreviousPricing(),
  catalog,
  costById,
  peakCostById,
  peak && peakWindow ? { window: peakWindow } : undefined,
);
if (decision.action === "skip") {
  console.log("rates unchanged since last run; pricing.json not touched");
  process.exit(0);
}
if (decision.action === "repair") {
  await publishCatalog(decision.catalog);
  console.log("catalog.json cost fields refreshed to match the current rates");
  process.exit(0);
}

await publishCatalog(decision.catalog);
await publishPricing(decision.pricing);
console.log(
  `published pricing.json and refreshed cost in catalog.json (${costById.size} standard, ${peakCostById.size} peak, source: ${PRICING_URL})`,
);