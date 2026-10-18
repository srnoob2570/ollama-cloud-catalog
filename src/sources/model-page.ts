// Second-chance pricing source. The rate card is family-level ("deepseek-v4.1-flash"),
// so a served variant it does not name (deepseek-v4.1-flash:1017) or a model added
// between card updates resolves as uncovered. Those get one more chance on their own
// ollama.com page, where every priced cloud model carries a cost block. URLs are
// never derived: the family's tag index — the "View all" of the library page's
// Models section, which lists one or several variants, cloud and local alike — is
// the only source of links, and the cost is read from the page it links to. A page
// without a cost block (beam, free promo since 2026-10-16) means no rate: absence,
// never a guess.
import * as cheerio from "cheerio";
import { fetchResponse, type FetchImpl } from "../lib/http.ts";
import { familyOf } from "../lib/ids.ts";
import type { RateRow } from "../catalog/schema.ts";

export const LIBRARY_URL = "https://ollama.com/library";

// ollama.com names the served-cloud page of a catalog id by marking the id: a
// tagged id gets "-cloud" (gemma4:31b → gemma4:31b-cloud, clef:27b → clef:27b-cloud),
// an untagged one gets ":cloud" (beam → beam:cloud). The name is only a lookup key
// into the tag index; the link always comes from the index, never from this rule.
export const cloudNameOf = (id: string) => (id.includes(":") ? `${id}-cloud` : `${id}:cloud`);

// The tag index: every variant page of the family, cloud and local, one href each
// (mobile and desktop anchors share hrefs, so the href dedupes them). The variant
// name is the href's path segment, never the anchor text around it.
export function extractTagIndex(html: string, family: string): Map<string, string> {
    const $ = cheerio.load(html);
    const index = new Map<string, string>();
    const prefix = `/library/${family}:`;
    for (const a of $("a[href^='/library/']").toArray()) {
        const href = $(a).attr("href");
        if (!href || !href.startsWith(prefix)) continue;
        const name = href.slice("/library/".length);
        index.set(name, `${LIBRARY_URL}/${name}`);
    }
    return index;
}

export type ModelCost = { rate: RateRow; offPeakRate?: RateRow };

// The cost block ("Cost /1M tokens") of a variant page. Cells are
// div.pricing-rate[data-rate]: data-rate="base" is the listed standard (Peak) rate
// and data-rate="peak" the Off-Peak column — the page's tab naming, not ours. Each
// cell's parent carries the label among its div children (input, cached, output).
// No cells at all means the page prices nothing: undefined. An unrecognized label
// or value aborts the run — a changed shape must be seen, not silently dropped.
const LABELS = new Set(["input", "cached", "output"]);

export function extractModelCost(id: string, html: string): ModelCost | undefined {
    const $ = cheerio.load(html);
    if ($("div.pricing-rate[data-rate]").length === 0) return undefined;
    const money = (text: string): number => {
        const match = /^\$([0-9]+(?:\.[0-9]+)?)$/.exec(text.trim());
        if (!match) throw new Error(`model page for ${id}: unrecognized cost value "${text.trim()}"`);
        return Number(match[1]);
    };
    // Read one column (base or peak) into label → dollars.
    const read = (column: string): Map<string, number> => {
        const cells = new Map<string, number>();
        for (const el of $(`div.pricing-rate[data-rate="${column}"]`).toArray()) {
            const label = $(el).parent().children("div").not("[data-rate]").first().text().trim();
            if (!LABELS.has(label)) throw new Error(`model page for ${id}: unrecognized cost cell "${label}"`);
            if (cells.has(label)) throw new Error(`model page for ${id}: duplicate cost cell "${label}"`);
            cells.set(label, money($(el).text()));
        }
        return cells;
    };
    const base = read("base");
    const input = base.get("input");
    // A cost block always prices input; a $0 input would make the model free, and
    // free models have no block at all (beam) — anything else is a changed shape.
    if (input === undefined || input <= 0) throw new Error(`model page for ${id}: cost block prices no positive input`);
    const rate: RateRow = {
        model: id,
        input,
        cached_input: base.get("cached") ?? null,
        output: base.get("output") ?? null,
    };
    const offPeak = read("peak");
    if (offPeak.size === 0) return { rate };
    // The off-peak column is a mirror of the standard one: the same labels, or a
    // shape we have never seen — refuse instead of guessing which cells carry over.
    if (offPeak.size !== base.size || [...base.keys()].some((label) => !offPeak.has(label)))
        throw new Error(`model page for ${id}: off-peak column does not mirror the standard column`);
    return {
        rate,
        offPeakRate: {
            model: `${id} (Off-Peak)`,
            input: offPeak.get("input")!,
            cached_input: offPeak.get("cached") ?? null,
            output: offPeak.get("output") ?? null,
        },
    };
}

// One uncovered id, priced from its own page when ollama.com publishes one. Absence
// — never a guess — when the family has no page (404), the index does not list the
// id's cloud variant, or the variant page shows no cost block. Any other failure
// aborts the run.
export async function fetchModelCost(id: string, impl: FetchImpl = fetch): Promise<ModelCost | undefined> {
    const family = familyOf(id);
    const tagsUrl = `${LIBRARY_URL}/${family}/tags`;
    const index = await fetchResponse(tagsUrl, undefined, impl);
    if (index.status === 404) return undefined;
    if (!(index.status >= 200 && index.status < 300)) throw new Error(`${tagsUrl} -> HTTP ${index.status}`);
    const url = extractTagIndex(index.text, family).get(cloudNameOf(id));
    if (!url) return undefined;
    const page = await fetchResponse(url, undefined, impl);
    // The index links this page; a broken link is ollama.com failing, not an
    // unpriced model, so it aborts instead of silently publishing no cost.
    if (!(page.status >= 200 && page.status < 300))
        throw new Error(`model page for ${id}: index links ${url} but it returned HTTP ${page.status}`);
    return extractModelCost(id, page.text);
}
