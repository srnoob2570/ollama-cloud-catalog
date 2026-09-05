// Pricing source: ollama.com/pricing is server-rendered HTML. We hand the LLM
// markdown tables (one for the standard rate card, one for peak pricing when
// present) and keep the DOM as ground truth for structure: row counts feed
// the completeness check, and the peak window text is read deterministically
// — the LLM only interprets cells into JSON.
import * as cheerio from "cheerio";
type Cheerio$ = ReturnType<typeof cheerio.load>;
import { fetchText } from "../lib/http.ts";

export const PRICING_URL = "https://ollama.com/pricing";

export async function fetchPricingHtml(): Promise<string> {
  return fetchText(PRICING_URL);
}

// Keep the pricing section's table skeleton and row anchors; drop classes,
// styles and scripts that carry no data. Throws if the section disappears.
export function extractPricingSection(html: string): string {
  const $ = cheerio.load(html);
  const section = $("section#model-pricing");
  if (section.length === 0)
    throw new Error("ollama.com/pricing: no section#model-pricing found");
  section.find("script,style,svg,nav,footer").remove();
  $("*", section)
    .contents()
    .filter((_, el) => el.type === "comment")
    .remove();
  section.find("*").each((_, el) => {
    const attrs = (el as { attribs?: Record<string, string> }).attribs;
    if (!attrs) return;
    for (const name of Object.keys(attrs))
      if (!(el.tagName === "a" && name === "href")) delete attrs[name];
  });
  return $.html(section);
}

export type PricingTable = { markdown: string; rowCount: number };

const tableToMarkdown = ($: ReturnType<typeof cheerio.load>, table: cheerio.Cheerio<never>): PricingTable => {
  const rows = table
    .find("tr")
    .map((_, tr) =>
      $(tr)
        .find("th,td")
        .map((__, cell) => $(cell).text().replace(/\s+/g, " ").trim())
        .get()
        .join(" | "),
    )
    .get()
    .filter((line) => line.length > 0);
  if (rows.length < 2)
    throw new Error("pricing table has no header + data rows");
  const [header, ...data] = rows;
  return {
    markdown: [
      `| ${header} |`,
      `|${new Array(header!.split("|").length).fill(" --- ").join("")}|`,
      ...data.map((r) => `| ${r} |`),
    ].join("\n"),
    rowCount: data.length,
  };
};

// The section holds up to two tables: the standard (off-peak) rate card
// first, then — since 2026-09 — a "Peak pricing" table (2x rates, 12:00-18:00
// UTC Mon-Fri) listing only the models subject to it. The peak window text
// is read from the page, not from the LLM.
export function extractPricingTables(html: string): {
  standard: PricingTable;
  peak: PricingTable | undefined;
  peakWindow: string | undefined;
} {
  const $ = cheerio.load(extractPricingSection(html));
  const tableToMarkdown = (table: cheerio.Cheerio<any>): PricingTable => {
    const rows = table
      .find("tr")
      .map((_, tr) =>
        $(tr)
          .find("th,td")
          .map((__, cell) => $(cell).text().replace(/\s+/g, " ").trim())
          .get()
          .join(" | "),
      )
      .get()
      .filter((line) => line.length > 0);
    if (rows.length < 2)
      throw new Error("pricing table has no header + data rows");
    const [header, ...data] = rows;
    return {
      markdown: [
        `| ${header} |`,
        `|${new Array(header!.split("|").length).fill(" --- ").join("")}|`,
        ...data.map((r) => `| ${r} |`),
      ].join("\n"),
      rowCount: data.length,
    };
  };
  const tables = $("table").toArray();
  if (tables.length === 0)
    throw new Error("pricing section contains no tables");
  const standard = tableToMarkdown($(tables[0]!));
  let peak: PricingTable | undefined;
  let peakWindow: string | undefined;
  const peakHeading = $("h3")
    .toArray()
    .find((h) => /peak pricing/i.test($(h).text()));
  if (peakHeading) {
    // The table may be a direct sibling or wrapped in a div (live page:
    // <h3/> <p/> <div class="overflow-x-auto"><table/></div>).
    const direct = $(peakHeading).nextAll("table").first();
    const peakTable =
      direct.length > 0 ? direct : $(peakHeading).nextAll().find("table").first();
    if (peakTable.length === 0)
      throw new Error("peak pricing heading found but no table after it");
    peak = tableToMarkdown(peakTable);
    peakWindow = $(peakHeading).nextAll("p").first().text().replace(/\s+/g, " ").trim() || undefined;
  }
  return { standard, peak, peakWindow };
}