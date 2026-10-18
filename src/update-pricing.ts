// update-pricing: scrape ollama.com/pricing, extract the rate cards with
// glm-5.3-flash (JSON mode + zod validation), then refresh cost in
// catalog.json and publish pricing.json. DOM row counts are ground truth
// for completeness; any coverage problem aborts before writing.
// Models the card leaves uncovered get one more chance on their own
// ollama.com page (src/sources/model-page.ts): a tagged variant the
// family-level card does not name prices from its library page.
// Peak pricing (a subset of models, higher rates 12:00-18:00 UTC Mon-Fri)
// is stored under x_ollama: `cost` always means the standard rate.
import { extractPricingTables, fetchPricingHtml, PRICING_URL } from "./sources/pricing-page.ts";
import { fetchModelCost } from "./sources/model-page.ts";
import { extractRates } from "./catalog/extract-rates.ts";
import { resolveRates } from "./catalog/resolve-rates.ts";
import type { RateRow } from "./catalog/schema.ts";
import {
    loadPreviousPricing,
    loadCatalog,
    publishCatalog,
    publishPricing,
    refreshDecision,
} from "./catalog/assemble.ts";

const { standard, peak, peakWindow, offPeakWindow } = extractPricingTables(await fetchPricingHtml());
console.log(
    `pricing tables extracted: ${standard.rowCount} standard rows` +
        (peak ? `, ${peak.rowCount} peak rows` : ", no peak table"),
);

const extraction = await extractRates(standard, peak);
console.log(`extracted ${extraction.rates.length} standard rates, ${extraction.peak_rates.length} peak rates`);

const catalog = await loadCatalog();
if (!catalog) throw new Error("catalog.json missing; run update-catalog first");
const models = new Map(Object.entries(catalog.provider.models));

const { costById, problems: standardProblems, uncovered, offPeakById } = resolveRates(extraction.rates, models);
const { costById: peakCostById, problems: peakProblems } = resolveRates(extraction.peak_rates, models, false);

// Second-chance pass: each uncovered model gets its cost from its own ollama.com
// page, discovered through the family's tag index (never a derived URL). A page
// without a cost block (beam, free promo) stays absence — the warning below.
const fichaRates: RateRow[] = [];
const stillUncovered: string[] = [];
for (const id of uncovered) {
    const ficha = await fetchModelCost(id);
    if (!ficha) {
        stillUncovered.push(id);
        continue;
    }
    console.log(`- ${id}: not on the rate card; priced from its library page`);
    fichaRates.push(ficha.rate);
    if (ficha.offPeakRate) fichaRates.push(ficha.offPeakRate);
}
let fichaProblems: string[] = [];
if (fichaRates.length > 0) {
    // The ficha rows resolve through the standard machinery: decision models
    // still price their free output/cache as $0, off-peak rows still mirror.
    const ficha = resolveRates(fichaRates, models, false);
    fichaProblems = ficha.problems;
    for (const [id, cost] of ficha.costById) costById.set(id, cost);
    for (const [id, cost] of ficha.offPeakById) offPeakById.set(id, cost);
}
const problems = [...standardProblems, ...peakProblems, ...fichaProblems];
if (problems.length > 0) {
    console.error(`x pricing coverage problems (${problems.length}):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
}
// Uncovered catalog models keep their previous cost, if any: the card and the
// library pages are the pricing sources, and both deliberately price some served
// models not at all (beam, free promo since 2026-10-16).
for (const id of stillUncovered)
    console.warn(
        `! catalog model ${id} has no rate on the pricing page or its library page; previous cost, if any, stands`,
    );
// extractPricingTables already refuses window-less off-peak rows; this guards
// the seam between the two modules.
if (offPeakById.size > 0 && !offPeakWindow)
    throw new Error("off-peak rates found but their window paragraph is missing");

// A refresh with identical rates is not a change: refreshDecision skips the
// write, repairs a lagging catalog, or publishes both artifacts.
const decision = refreshDecision(
    await loadPreviousPricing(),
    catalog,
    costById,
    peakCostById,
    peak && peakWindow ? { window: peakWindow } : undefined,
    offPeakById.size > 0 && offPeakWindow ? { window: offPeakWindow, costById: offPeakById } : undefined,
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
    `published pricing.json and refreshed cost in catalog.json (${costById.size} standard, ${peakCostById.size} peak, ` +
        `${offPeakById.size} off-peak, source: ${PRICING_URL})`,
);
