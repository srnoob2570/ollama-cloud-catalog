// Rate-card extraction: the LLM prompt IS the contract. The prompt text, its
// row-count anchors and the completeness checks live here so that editing the
// prompt is a tested edit, not a production experiment. One LLM call covers
// both tables; peak rates ride in the same object under peak_rates.
import type { z } from "zod";
import { extractJson } from "../extract/ai.ts";
import { RateCardExtractionSchema } from "./schema.ts";
import type { PricingTable } from "../sources/pricing-page.ts";

type RateCardExtraction = z.infer<typeof RateCardExtractionSchema>;

type RateCall = (
    schema: typeof RateCardExtractionSchema,
    instructions: string,
    user: string,
) => Promise<RateCardExtraction>;

const tableLabel = (label: string, table: PricingTable): string => `## ${label}\n${table.markdown}`;

export function buildRatePrompt(
    standard: PricingTable,
    peak: PricingTable | undefined,
): { instructions: string; user: string } {
    const instructions = [
        `You extract Ollama's model pricing rate cards from markdown tables.`,
        `TABLE 1 is the standard rate card with exactly ${standard.rowCount} rate rows; "rates" must contain exactly those ${standard.rowCount} rows in order.`,
        peak
            ? `TABLE 2 is the peak-pricing rate card with exactly ${peak.rowCount} rate rows; "peak_rates" must contain exactly those ${peak.rowCount} rows in order.`
            : `There is no peak-pricing table; "peak_rates" must be an empty array.`,
        `The "Model" column holds the full model id, including any tag suffix (e.g. 'gpt-oss:120b' — never drop the tag). Prices are US dollars per million tokens; strip the $ sign and report plain numbers. A '-' cell means null (no rate).`,
    ].join(" ");
    const user = [tableLabel("Standard rate card", standard), peak ? tableLabel("Peak pricing", peak) : ""]
        .filter(Boolean)
        .join("\n\n");
    return { instructions, user };
}

// DOM row counts are ground truth for completeness; any mismatch aborts the
// run before rates reach the catalog or pricing.json.
export async function extractRates(
    standard: PricingTable,
    peak: PricingTable | undefined,
    call: RateCall = extractJson,
): Promise<RateCardExtraction> {
    const { instructions, user } = buildRatePrompt(standard, peak);
    const extraction = await call(RateCardExtractionSchema, instructions, user);
    if (extraction.rates.length !== standard.rowCount)
        throw new Error(
            `standard rate extraction incomplete: got ${extraction.rates.length}, table has ${standard.rowCount} rows`,
        );
    if (extraction.peak_rates.length !== (peak?.rowCount ?? 0))
        throw new Error(
            `peak rate extraction incomplete: got ${extraction.peak_rates.length}, table has ${peak?.rowCount ?? 0} rows`,
        );
    return extraction;
}
