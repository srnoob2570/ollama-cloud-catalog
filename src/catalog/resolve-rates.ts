// Rate-card → catalog resolution, ported from the original update-pricing.
// Rate names come from the table's link text (family-level ids, Ollama's
// rate card only sometimes lists tags), so the lookup tries the exact id
// first and otherwise the unique family match. Ambiguous families throw and
// unknown rate rows are problems. A catalog model the card does not price
// (e.g. beam, free promo since 2026-10-16) is reported for a warning, not
// an abort: the page is the only pricing source and it prices what it
// prices. Any problem aborts the update. Nothing is ever silently dropped.
import { familyOf } from "../lib/ids.ts";
import type { Cost, Model, RateRow } from "./schema.ts";

export type RateResolution = {
    costById: Map<string, Cost>;
    problems: string[];
    // Catalog models with no standard rate row. The caller warns and any
    // previous cost stands; never fatal on its own.
    uncovered: string[];
    // Models whose "(Off-Peak)" mirror rows were verified but are NOT
    // published: the page carries no time window, and time-varying rates
    // without their window are refused (same rule as the old peak table,
    // see extractPricingTables).
    offPeak: string[];
};

// Since 2026-10-16 the single rate card lists a model priced differently
// off-peak twice: the second row repeats the model name with this suffix.
const OFF_PEAK_RE = / \(Off-Peak\)$/i;

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
    // The standard card reports uncovered catalog models; the peak card
    // covers only a subset Ollama peak-prices, so uncovered models are
    // normal there and go unreported.
    checkCoverage = true,
): RateResolution {
    const catalogIds = [...models.keys()];
    const costById = new Map<string, Cost>();
    const problems: string[] = [];
    const uncovered: string[] = [];
    const offPeak: string[] = [];
    const baseRates = rates.filter((rate) => !OFF_PEAK_RE.test(rate.model));
    const offPeakRates = rates.filter((rate) => OFF_PEAK_RE.test(rate.model));

    for (const rate of baseRates) {
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
            // A '-' output cell (decision models price input only) means no
            // output rate exists; absence, never a guess.
            ...(rate.output !== null ? { output: rate.output } : {}),
        });
    }

    // Mirror rows must shadow a standard row of the same model: an off-peak
    // rate for a model the card does not price at all is a data problem.
    for (const rate of offPeakRates) {
        const bare = rate.model.replace(OFF_PEAK_RE, "");
        const id = resolveRateId(bare, catalogIds);
        if (id === undefined) {
            problems.push(`off-peak rate "${rate.model}" does not match any catalog model`);
            continue;
        }
        if (!costById.has(id)) {
            problems.push(`off-peak rate for ${id} has no standard row to mirror`);
            continue;
        }
        offPeak.push(id);
    }

    if (checkCoverage) for (const id of catalogIds) if (!costById.has(id)) uncovered.push(id);

    return { costById, problems, uncovered, offPeak };
}
