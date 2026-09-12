import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { extractPricingSection, extractPricingTables } from "../src/sources/pricing-page.ts";
import { reasoningOptionsOf, seedReasoningOptions } from "../src/sources/models-dev.ts";
import { fetchAllSpecs, fetchModelSpec } from "../src/sources/show.ts";
import { fetchModelsList } from "../src/sources/models-api.ts";
import { modelsHash, stableStringify } from "../src/lib/artifacts.ts";
import { displayName } from "../src/lib/ids.ts";
import { resolveRateId, resolveRates } from "../src/catalog/resolve-rates.ts";
import { decideRebuild } from "../src/catalog/gate.ts";
import {
    CatalogDocSchema,
    ModelSchema,
    PricingDocSchema,
    RateCardExtractionSchema,
    type CatalogDoc,
} from "../src/catalog/schema.ts";
import {
    buildCatalogDoc,
    buildPricingDoc,
    applyCosts,
    refreshDecision,
    modelsWithoutCost,
} from "../src/catalog/assemble.ts";
import { buildRatePrompt, extractRates } from "../src/catalog/extract-rates.ts";
import { extractJson } from "../src/extract/ai.ts";
import { SHOW_GLM53, PROBE_GLM53_ERROR, PRICING_SECTION, PRICING_SECTION_PEAK } from "./fixtures.ts";

// Route requests by URL substring: a plain value becomes a 200 JSON
// Response, a function returns its own Response, a miss throws. Injected
// through the fetchImpl seam in lib/http.ts, with no global mutation.
const fakeFetch = (routes: Record<string, unknown | (() => Response)>) =>
    (async (input: RequestInfo | URL) => {
        const url = String(input);
        for (const [pattern, body] of Object.entries(routes))
            if (url.includes(pattern)) {
                const response =
                    typeof body === "function"
                        ? (body as () => Response)()
                        : new Response(JSON.stringify(body), { status: 200 });
                return response;
            }
        throw new Error(`unexpected fetch in test: ${url}`);
    }) as typeof fetch;

describe("ids", () => {
    test("titleCase with acronyms and tags", () => {
        expect(displayName("gpt-oss:120b")).toBe("GPT OSS 120B");
        expect(displayName("glm-5.3-flash")).toBe("GLM 5.3 Flash");
        expect(displayName("deepseek-v4-pro:0813")).toBe("Deepseek V4 Pro 0813");
    });
});

describe("hash gate", () => {
    test("hash is sensitive to created and id", () => {
        const a = modelsHash([{ id: "glm-5.3", created: 1 }]);
        const b = modelsHash([{ id: "glm-5.3", created: 2 }]);
        const c = modelsHash([{ id: "glm-5.4", created: 1 }]);
        expect(a).not.toBe(b);
        expect(a).not.toBe(c);
        expect(a).toBe(modelsHash([{ id: "glm-5.3", created: 1 }]));
    });

    test("stableStringify sorts keys for stable diffs", () => {
        expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    });
});

describe("pricing page extraction", () => {
    test("keeps the section, strips attributes", () => {
        const html = `<html><body><nav>x</nav><section id="model-pricing"><table class="w"><tr><td><a href="/library/glm-5.3" class="link">glm-5.3</a></td><td>$1</td></tr></table></section></body></html>`;
        const out = extractPricingSection(html);
        expect(out).toContain("/library/glm-5.3");
        expect(out).not.toContain("class=");
        expect(out).not.toContain("<nav>");
    });

    test("fails loud when the section disappears", () => {
        expect(() => extractPricingSection("<html><body>nope</body></html>")).toThrow("no section#model-pricing");
    });
});

describe("peak pricing extraction", () => {
    test("single-table section has no peak", () => {
        const { standard, peak, peakWindow } = extractPricingTables(PRICING_SECTION);
        expect(standard.rowCount).toBe(5);
        expect(peak).toBeUndefined();
        expect(peakWindow).toBeUndefined();
    });

    test("peak table is split out with its window text", () => {
        const { standard, peak, peakWindow } = extractPricingTables(PRICING_SECTION_PEAK);
        expect(standard.rowCount).toBe(5);
        expect(peak?.rowCount).toBe(2);
        expect(peak?.markdown).toContain("deepseek-v4-flash");
        expect(peak?.markdown).not.toContain("gemma4");
        expect(peakWindow).toContain("12:00 and 18:00");
    });

    test("peak table without its window paragraph fails loud", () => {
        const html = `<section id="model-pricing">
      <table><tr><th>Model</th><th>Input</th></tr><tr><td><a href="/library/glm-5.3">glm-5.3</a></td><td>$1</td></tr></table>
      <h3>Peak pricing</h3>
      <table><tr><th>Model</th><th>Input</th></tr><tr><td><a href="/library/glm-5.3">glm-5.3</a></td><td>$2</td></tr></table>
    </section>`;
        expect(() => extractPricingTables(html)).toThrow("window paragraph is missing");
    });
});

describe("peak_rate extraction contract", () => {
    test("peak_rates may be empty when the page has no peak table", () => {
        const doc = RateCardExtractionSchema.parse({
            rates: [{ model: "glm-5.3", input: 1.4, cached_input: 0.26, output: 4.4 }],
            peak_rates: [],
        });
        expect(doc.peak_rates).toEqual([]);
    });
});

describe("models.dev reasoning seed", () => {
    const seed = new Map([
        ["glm-5.3", ["low", "high", "max"]],
        ["deepseek-v4-flash", ["high", "max"]],
    ]);

    test("effort entries only; non-effort and non-string values dropped", () => {
        expect(
            reasoningOptionsOf({
                reasoning_options: [
                    { type: "toggle", values: ["x"] },
                    { type: "effort", values: ["high", "max", 42, null] },
                ],
            }),
        ).toEqual(["high", "max"]);
    });

    test("no effort entries → omitted", () => {
        expect(reasoningOptionsOf({ reasoning_options: [{ type: "toggle" }] })).toBeUndefined();
        expect(reasoningOptionsOf({})).toBeUndefined();
    });

    test("lookup by exact id, then family, then miss", () => {
        expect(seedReasoningOptions(seed, "glm-5.3")).toEqual(["low", "high", "max"]);
        expect(seedReasoningOptions(seed, "deepseek-v4-flash:0731")).toEqual(["high", "max"]);
        expect(seedReasoningOptions(seed, "who-dis")).toBeUndefined();
    });
});

describe("resolveRateId", () => {
    const ids = ["deepseek-v4-flash:0731", "glm-5.3", "glm-5.3-flash"];
    test("exact id", () => {
        expect(resolveRateId("glm-5.3", ids)).toBe("glm-5.3");
    });
    test("family-unique fallback", () => {
        expect(resolveRateId("deepseek-v4-flash", ids)).toBe("deepseek-v4-flash:0731");
    });
    test("ambiguous family throws", () => {
        expect(() => resolveRateId("gemma4", ["gemma4:31b", "gemma4:9b"])).toThrow("ambiguous");
    });
    test("unknown returns undefined", () => {
        expect(resolveRateId("mistral-large-3", ids)).toBeUndefined();
    });
});

describe("coverage", () => {
    test("any problem aborts", () => {
        const model = ModelSchema.parse({
            id: "glm-5.3",
            name: "Glm 5.3",
            attachment: false,
            reasoning: true,
            tool_call: true,
            limit: { context: 202000 },
            release_date: "2026-08-27",
            x_ollama: { quantization: "FP8", ollama_family: "glm", parameter_count: 358000000000 },
        });
        const models = new Map([[model.id, model]]);
        const rates = [{ model: "glm-5.3", input: 1.4, cached_input: 0.26, output: 4.4 }];
        expect(resolveRates(rates, models).problems).toEqual([]);
        expect(resolveRates([], models).problems).toHaveLength(1);
        expect(
            resolveRates([{ model: "who-dis", input: 1, cached_input: 1, output: 1 }], models).problems,
        ).toHaveLength(2);
    });
});

describe("/api/show mapping", () => {
    // fetchModelSpec hits two endpoints: /api/show (spec) and /api/chat
    // (output-limit probe). Route the injected impl by URL substring.

    test("maps capabilities, limits and x-ollama metadata", async () => {
        const impl = fakeFetch({
            "/api/show": SHOW_GLM53,
            "/api/chat": () => new Response(JSON.stringify(PROBE_GLM53_ERROR), { status: 400 }),
        });
        const model = await fetchModelSpec("glm-5.3", impl);
        expect(model.name).toBe("GLM 5.3");
        expect(model.reasoning).toBe(true);
        expect(model.tool_call).toBe(true);
        expect(model.attachment).toBe(true);
        expect(model.modalities?.input).toEqual(["text", "image"]);
        expect(model.limit).toEqual({ context: 202000, output: 1048576 });
        expect(model.release_date).toBe("2026-08-27");
        expect(model.x_ollama.quantization).toBe("FP8");
        expect(model.x_ollama.parameter_count).toBe(358000000000);
    });

    test("404 from /api/show fails loud", async () => {
        const impl = fakeFetch({
            "/api/show": () => new Response("not found", { status: 404 }),
        });
        await expect(fetchModelSpec("who-dis", impl)).rejects.toThrow("HTTP 404");
    });

    test("probe without auth fails loud with a clear cause", async () => {
        const impl = fakeFetch({
            "/api/show": SHOW_GLM53,
            "/api/chat": () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        });
        await expect(fetchModelSpec("glm-5.3", impl)).rejects.toThrow("OLLAMA_API_KEY");
    });

    test("probe with changed error format fails loud", async () => {
        const impl = fakeFetch({
            "/api/show": SHOW_GLM53,
            "/api/chat": () => new Response(JSON.stringify({ error: "something else" }), { status: 400 }),
        });
        await expect(fetchModelSpec("glm-5.3", impl)).rejects.toThrow("unrecognized error");
    });
});

describe("fetchAllSpecs fallback matrix", () => {
    const spec = () =>
        ModelSchema.parse({
            id: "glm-5.3",
            name: "Glm 5.3",
            attachment: false,
            reasoning: true,
            tool_call: true,
            limit: { context: 202000 },
            release_date: "2026-08-27",
            x_ollama: { quantization: "FP8", ollama_family: "glm" },
        });

    test("a 401 aborts the sweep even when a previous spec exists", async () => {
        const impl = fakeFetch({
            "/api/show": SHOW_GLM53,
            "/api/chat": () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
        });
        await expect(fetchAllSpecs(["glm-5.3"], new Map([["glm-5.3", spec()]]), 1, impl)).rejects.toThrow(
            "needs OLLAMA_API_KEY",
        );
    });

    test("a transient per-model failure falls back to the previous spec", async () => {
        const impl = fakeFetch({
            "/api/show": () => new Response("boom", { status: 500 }),
        });
        const specs = await fetchAllSpecs(["glm-5.3"], new Map([["glm-5.3", spec()]]), 1, impl);
        expect(specs.map((s) => s.id)).toEqual(["glm-5.3"]);
    });

    test("a failure with no previous spec aborts", async () => {
        const impl = fakeFetch({
            "/api/show": () => new Response("boom", { status: 500 }),
        });
        await expect(fetchAllSpecs(["glm-5.3"], new Map(), 1, impl)).rejects.toThrow("no previous spec exists");
    });
});

describe("extractJson transport contract", () => {
    const KEY = process.env.OLLAMA_API_KEY;
    const withKey = (fn: () => Promise<void>) => async () => {
        process.env.OLLAMA_API_KEY = "test-key";
        try {
            await fn();
        } finally {
            if (KEY === undefined) delete process.env.OLLAMA_API_KEY;
            else process.env.OLLAMA_API_KEY = KEY;
        }
    };

    test(
        "sends the structured-output contract and parses the reply",
        withKey(async () => {
            const requests: { url: string; init: RequestInit | undefined }[] = [];
            const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
                requests.push({ url: String(input), init });
                return new Response(
                    JSON.stringify({
                        message: {
                            content: JSON.stringify({
                                rates: [{ model: "glm-5.3", input: 1, cached_input: 0.5, output: 2 }],
                                peak_rates: [],
                            }),
                        },
                    }),
                    { status: 200 },
                );
            }) as typeof fetch;
            const out = await extractJson(RateCardExtractionSchema, "INSTRUCTIONS", "USER", impl);
            expect(out.rates).toHaveLength(1);
            expect(requests).toHaveLength(1);
            const { url, init } = requests[0]!;
            expect(url).toBe("https://ollama.com:443/api/chat");
            const body = JSON.parse(String(init!.body));
            expect(body.format).toEqual(z.toJSONSchema(RateCardExtractionSchema, { target: "draft-7", io: "input" }));
            expect(body.stream).toBe(false);
            expect(body.options.temperature).toBe(0);
            const system = body.messages[0].content as string;
            expect(system.startsWith("INSTRUCTIONS\n")).toBe(true);
            expect(system).toContain("JSON Schema");
            expect(body.messages[1].content).toBe("USER");
            const headers = init!.headers as Record<string, string>;
            expect(headers.Authorization ?? headers.authorization).toBe("Bearer test-key");
        }),
    );

    test(
        "missing OLLAMA_API_KEY aborts without a request",
        withKey(async () => {
            delete process.env.OLLAMA_API_KEY;
            const impl = fakeFetch({});
            await expect(extractJson(RateCardExtractionSchema, "i", "u", impl)).rejects.toThrow(
                "OLLAMA_API_KEY is not set",
            );
            process.env.OLLAMA_API_KEY = "test-key";
        }),
    );

    test(
        "an off-contract reply aborts",
        withKey(async () => {
            const impl = fakeFetch({
                "/api/chat": () => new Response(JSON.stringify({ message: { content: "not json" } }), { status: 200 }),
            });
            await expect(extractJson(RateCardExtractionSchema, "i", "u", impl)).rejects.toThrow();
        }),
    );
});

describe("rebuild gate", () => {
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const t0 = Date.parse("2026-09-01T00:00:00.000Z");
    const prev = (modelsHash: string, generatedAt: string) => ({
        x_ollama: { models_hash: modelsHash, generated_at: generatedAt },
    });

    test("first run rebuilds without a previous artifact", () => {
        expect(decideRebuild(undefined, "h", t0, false)).toEqual({
            action: "rebuild",
            reason: "no-previous",
        });
    });

    test("--force overrides an up-to-date artifact", () => {
        expect(decideRebuild(prev("h", new Date(t0).toISOString()), "h", t0, true)).toEqual({
            action: "rebuild",
            reason: "force",
        });
    });

    test("hash change triggers a rebuild", () => {
        expect(decideRebuild(prev("old", new Date(t0).toISOString()), "new", t0, false)).toEqual({
            action: "rebuild",
            reason: "hash-changed",
        });
    });

    test("stale artifact with unchanged hash rebuilds (bug class: refresh window)", () => {
        expect(decideRebuild(prev("h", new Date(t0 - WEEK_MS - 1).toISOString()), "h", t0, false)).toEqual({
            action: "rebuild",
            reason: "stale",
        });
    });

    test("stale artifact with a changed hash reports hash-changed, rebuilding either way", () => {
        expect(decideRebuild(prev("old", new Date(t0 - WEEK_MS - 1).toISOString()), "new", t0, false)).toEqual({
            action: "rebuild",
            reason: "hash-changed",
        });
    });

    test("boundary: exactly seven days old is still fresh", () => {
        expect(decideRebuild(prev("h", new Date(t0 - WEEK_MS).toISOString()), "h", t0, false)).toEqual({
            action: "skip",
        });
    });

    test("fresh artifact with unchanged hash skips", () => {
        expect(decideRebuild(prev("h", new Date(t0 - 1).toISOString()), "h", t0, false)).toEqual({
            action: "skip",
        });
    });
});

describe("models list validation", () => {
    test("duplicate ids fail loud", async () => {
        const impl = fakeFetch({
            "/models": {
                data: [
                    { id: "glm-5.3", created: 1 },
                    { id: "glm-5.3", created: 2 },
                ],
            },
        });
        await expect(fetchModelsList("https://ollama.com/v1", undefined, impl)).rejects.toThrow("duplicate ids");
    });
});

describe("reasoning seed fold", () => {
    const spec = ModelSchema.parse({
        id: "glm-5.3",
        name: "Glm 5.3",
        attachment: false,
        reasoning: true,
        tool_call: true,
        limit: { context: 202000 },
        release_date: "2026-08-27",
        x_ollama: { quantization: "FP8", ollama_family: "glm", parameter_count: 358000000000 },
    });
    const build = (seed?: Map<string, string[]>, prior?: Map<string, string[]>) =>
        buildCatalogDoc({
            modelsHash: "a".repeat(64),
            specs: [spec],
            costs: new Map(),
            ...(seed ? { reasoningSeed: seed } : {}),
            ...(prior ? { reasoningPrior: prior } : {}),
        });
    const options = (doc: CatalogDoc) => doc.provider.models["glm-5.3"]?.x_ollama.reasoning_options;

    test("seed wins over prior", () => {
        expect(options(build(new Map([["glm-5.3", ["high"]]]), new Map([["glm-5.3", ["low"]]])))).toEqual(["high"]);
    });

    test("no seed → previous artifact's options", () => {
        expect(options(build(undefined, new Map([["glm-5.3", ["low"]]])))).toEqual(["low"]);
    });

    test("seed miss on exact id falls back to the family, then to prior", () => {
        // models.dev indexes some models without their tag: 'glm-5.3' seeds the
        // tagged spec 'glm-5.3:fp8' through the family lookup.
        const tagged = ModelSchema.parse({
            ...spec,
            id: "glm-5.3:fp8",
        });
        const doc = buildCatalogDoc({
            modelsHash: "a".repeat(64),
            specs: [tagged],
            costs: new Map(),
            reasoningSeed: new Map([["glm-5.3", ["high"]]]),
        });
        expect(doc.provider.models["glm-5.3:fp8"]?.x_ollama.reasoning_options).toEqual(["high"]);
        expect(options(build(new Map([["who", ["high"]]]), new Map([["glm-5.3", ["low"]]])))).toEqual(["low"]);
    });

    test("neither seed nor prior → field omitted, never an empty array", () => {
        expect(options(build())).toBeUndefined();
    });

    test("local override wins over seed and prior", () => {
        const ds = ModelSchema.parse({
            ...spec,
            id: "deepseek-v4.1-flash",
            name: "Deepseek V4.1 Flash",
        });
        const doc = buildCatalogDoc({
            modelsHash: "a".repeat(64),
            specs: [ds],
            costs: new Map(),
            reasoningSeed: new Map([["deepseek-v4.1-flash", ["high"]]]),
            reasoningPrior: new Map([["deepseek-v4.1-flash", ["low"]]]),
        });
        expect(doc.provider.models["deepseek-v4.1-flash"]?.x_ollama.reasoning_options).toEqual(["low", "high", "max"]);
    });

    test("override reaches tagged variants through the family lookup", () => {
        const tagged = ModelSchema.parse({
            ...spec,
            id: "deepseek-v4.1-flash:fp8",
            name: "Deepseek V4.1 Flash FP8",
        });
        const doc = buildCatalogDoc({
            modelsHash: "a".repeat(64),
            specs: [tagged],
            costs: new Map(),
        });
        expect(doc.provider.models["deepseek-v4.1-flash:fp8"]?.x_ollama.reasoning_options).toEqual([
            "low",
            "high",
            "max",
        ]);
    });
});

describe("artifact assembly", () => {
    test("full round trip: catalog + pricing docs validate", () => {
        const specs = [
            ModelSchema.parse({
                id: "glm-5.3",
                name: "Glm 5.3",
                attachment: false,
                reasoning: true,
                tool_call: true,
                limit: { context: 202000, output: 32768 },
                release_date: "2026-08-27",
                x_ollama: { quantization: "FP8", ollama_family: "glm", parameter_count: 358000000000 },
            }),
        ];
        const doc = buildCatalogDoc({
            modelsHash: modelsHash([{ id: "glm-5.3", created: 1 }]),
            specs,
            costs: new Map([["glm-5.3", { input: 1.4, output: 4.4, cache_read: 0.26 }]]),
        });
        expect(CatalogDocSchema.parse(doc)).toBeDefined();
        expect(doc.provider.models["glm-5.3"]?.cost).toEqual({
            input: 1.4,
            output: 4.4,
            cache_read: 0.26,
        });

        const pricing = buildPricingDoc(new Map([["glm-5.3", { input: 1.4, cache_read: 0.26, output: 4.4 }]]));
        expect(pricing.models["glm-5.3"]).toBeDefined();

        const costless = applyCosts(doc, new Map(), new Map());
        // applyCosts only refreshes ids present in the cost map. Specs, hash and
        // unknown ids keep their previous state. Standard cost is never removed;
        // the peak map is authoritative.
        expect(costless.provider.models["glm-5.3"]?.cost).toBeDefined();
        const repriced = applyCosts(doc, new Map([["glm-5.3", { input: 2, output: 6, cache_read: 0.3 }]]), new Map());
        expect(repriced.provider.models["glm-5.3"]?.cost).toEqual({
            input: 2,
            output: 6,
            cache_read: 0.3,
        });
        expect(costless.x_ollama.models_hash).toBe(doc.x_ollama.models_hash);
    });

    test("costless models are the ones the cost map does not cover", () => {
        const spec = (id: string) =>
            ModelSchema.parse({
                id,
                name: id,
                attachment: false,
                reasoning: true,
                tool_call: true,
                limit: { context: 202000 },
                release_date: "2026-08-27",
                x_ollama: { quantization: "FP8", ollama_family: "glm" },
            });
        const specs = [spec("glm-5.3"), spec("glm-5.3-flash")];
        const doc = buildCatalogDoc({
            modelsHash: "a".repeat(64),
            specs,
            costs: new Map([["glm-5.3", { input: 1.4, output: 4.4, cache_read: 0.26 }]]),
        });
        expect(modelsWithoutCost(doc)).toEqual(["glm-5.3-flash"]);
        expect(
            modelsWithoutCost(
                buildCatalogDoc({
                    modelsHash: "a".repeat(64),
                    specs,
                    costs: new Map([
                        ["glm-5.3", { input: 1.4, output: 4.4, cache_read: 0.26 }],
                        ["glm-5.3-flash", { input: 0.15, output: 0.5, cache_read: 0.03 }],
                    ]),
                }),
            ),
        ).toEqual([]);
    });

    test("peak costs land under x_ollama.peak_cost and in pricing.json", () => {
        const spec = (id: string) =>
            ModelSchema.parse({
                id,
                name: id,
                attachment: false,
                reasoning: true,
                tool_call: true,
                limit: { context: 202000 },
                release_date: "2026-08-27",
                x_ollama: { quantization: "FP8", ollama_family: "glm" },
            });
        const specs = [spec("glm-5.3"), spec("glm-5.3-flash")];
        const costs = new Map([
            ["glm-5.3", { input: 1.4, output: 4.4, cache_read: 0.26 }],
            ["glm-5.3-flash", { input: 0.15, output: 0.5, cache_read: 0.03 }],
        ]);
        const peakCosts = new Map([["glm-5.3", { input: 2.8, output: 8.8, cache_read: 0.52 }]]);

        const doc = buildCatalogDoc({ modelsHash: "a".repeat(64), specs, costs, peakCosts });
        expect(doc.provider.models["glm-5.3"]?.x_ollama.peak_cost).toEqual({
            input: 2.8,
            output: 8.8,
            cache_read: 0.52,
        });
        expect(doc.provider.models["glm-5.3-flash"]?.x_ollama.peak_cost).toBeUndefined();

        const pricing = buildPricingDoc(costs, {
            window: "Peak pricing applies between 12:00 and 18:00 UTC, Monday to Friday.",
            costById: peakCosts,
        });
        expect(PricingDocSchema.parse(pricing)).toBeDefined();
        expect(pricing.x_ollama?.peak_window).toContain("12:00 and 18:00");
        expect(pricing.x_ollama?.models["glm-5.3"]).toEqual({
            input: 2.8,
            output: 8.8,
            cache_read: 0.52,
        });
        expect(pricing.x_ollama?.models["glm-5.3-flash"]).toBeUndefined();

        // No-peak variant: pricing doc carries no x_ollama at all.
        const flat = buildPricingDoc(costs);
        expect(flat.x_ollama).toBeUndefined();

        // Merge-back: peak only touches the models the rate card peak-prices.
        const repriced = applyCosts(doc, costs, peakCosts);
        expect(repriced.provider.models["glm-5.3"]?.x_ollama.peak_cost).toBeDefined();
        expect(repriced.provider.models["glm-5.3-flash"]?.x_ollama.peak_cost).toBeUndefined();
        expect(repriced.x_ollama.models_hash).toBe(doc.x_ollama.models_hash);

        // The peak map is authoritative: a model missing from it loses its
        // stale peak_cost (a rate card that stopped peak-pricing it).
        const unpeaked = applyCosts(doc, costs, new Map());
        expect(unpeaked.provider.models["glm-5.3"]?.x_ollama.peak_cost).toBeUndefined();
        expect(unpeaked.provider.models["glm-5.3"]?.cost).toEqual(costs.get("glm-5.3"));
        // An empty peak map leaves the standard cost untouched.
        const costOnly = applyCosts(doc, costs, new Map());
        expect(costOnly.provider.models["glm-5.3-flash"]?.cost).toEqual(costs.get("glm-5.3-flash"));
    });
});

describe("rate card extraction", () => {
    const withPeak = extractPricingTables(PRICING_SECTION_PEAK);
    const withoutPeak = extractPricingTables(PRICING_SECTION);
    const rate = (model: string) => ({ model, input: 1.4, cached_input: 0.26, output: 4.4 });
    const call = async () => ({
        rates: withPeak.standard.rowCount ? [1, 2, 3, 4, 5].map((n) => rate(`m-${n}`)) : [],
        peak_rates: withPeak.peak ? [1, 2].map((n) => rate(`p-${n}`)) : [],
    });

    test("golden prompt snapshot", () => {
        expect(buildRatePrompt(withPeak.standard, withPeak.peak)).toMatchSnapshot();
    });

    test("no peak table anchors peak_rates as an empty array", () => {
        const prompt = buildRatePrompt(withoutPeak.standard, undefined);
        expect(prompt.instructions).toContain('"peak_rates" must be an empty array');
        expect(prompt.user).not.toContain("Peak pricing");
    });

    test("an incomplete LLM response aborts", async () => {
        const short = async () => ({ rates: [rate("glm-5.3")], peak_rates: [] });
        await expect(extractRates(withPeak.standard, withPeak.peak, short as never)).rejects.toThrow(
            "standard rate extraction incomplete",
        );
    });

    test("an incomplete peak table aborts", async () => {
        const shortPeak = async () => ({
            rates: [1, 2, 3, 4, 5].map((n) => rate(`m-${n}`)),
            peak_rates: [rate("p-1")],
        });
        await expect(extractRates(withPeak.standard, withPeak.peak, shortPeak as never)).rejects.toThrow(
            "peak rate extraction incomplete",
        );
    });

    test("a complete response passes through", async () => {
        const extraction = await extractRates(withPeak.standard, withPeak.peak, call as never);
        expect(extraction.rates).toHaveLength(withPeak.standard.rowCount);
        expect(extraction.peak_rates).toHaveLength(withPeak.peak?.rowCount ?? 0);
    });
});

describe("pricing refresh decision", () => {
    const standard = { input: 1.4, output: 4.4, cache_read: 0.26 };
    const peak = { input: 2.8, output: 8.8, cache_read: 0.52 };
    const model = ModelSchema.parse({
        id: "glm-5.3",
        name: "Glm 5.3",
        attachment: false,
        reasoning: true,
        tool_call: true,
        limit: { context: 202000 },
        release_date: "2026-08-27",
        x_ollama: { quantization: "FP8", ollama_family: "glm", parameter_count: 358000000000 },
    });
    const costless = buildCatalogDoc({
        modelsHash: "a".repeat(64),
        specs: [model],
        costs: new Map(),
    });
    const upToDate = buildCatalogDoc({
        modelsHash: "a".repeat(64),
        specs: [model],
        costs: new Map([["glm-5.3", standard]]),
    });
    const pricingDoc = (
        models: Record<string, { input: number; output: number; cache_read: number }>,
        x_ollama?: unknown,
    ) =>
        PricingDocSchema.parse({
            $schema: "https://example.com/pricing.schema.json",
            provider: "ollama-cloud",
            generated_at: "2026-09-01T00:00:00.000Z",
            source: "https://ollama.com/pricing",
            models,
            ...(x_ollama ? { x_ollama } : {}),
        });

    test("first run publishes both artifacts", () => {
        const decision = refreshDecision(undefined, costless, new Map([["glm-5.3", standard]]), new Map());
        expect(decision.action).toBe("publish");
        if (decision.action === "publish") {
            expect(decision.pricing.models["glm-5.3"]).toEqual(standard);
            expect(decision.catalog.provider.models["glm-5.3"]?.cost).toEqual(standard);
        }
    });

    test("identical rates skip the write", () => {
        const previous = pricingDoc({ "glm-5.3": standard });
        const decision = refreshDecision(previous, upToDate, new Map([["glm-5.3", standard]]), new Map());
        expect(decision.action).toBe("skip");
    });

    test("volatile fields alone never trigger a publish", () => {
        const previous = pricingDoc({ "glm-5.3": standard });
        previous.generated_at = "2026-09-02T00:00:00.000Z";
        const decision = refreshDecision(previous, upToDate, new Map([["glm-5.3", standard]]), new Map());
        expect(decision.action).toBe("skip");
    });

    test("identical rates repair a lagging catalog", () => {
        // A rebuild between pricing runs dropped the cost fields; the rates are
        // unchanged, so the merge-back is repaired without touching pricing.json.
        const previous = pricingDoc({ "glm-5.3": standard });
        const decision = refreshDecision(previous, costless, new Map([["glm-5.3", standard]]), new Map());
        expect(decision.action).toBe("repair");
        if (decision.action === "repair") expect(decision.catalog.provider.models["glm-5.3"]?.cost).toEqual(standard);
        expect(decision.action !== "publish");
    });

    test("repair keeps hash and generation stamp intact", () => {
        const previous = pricingDoc({ "glm-5.3": standard });
        const decision = refreshDecision(previous, costless, new Map([["glm-5.3", standard]]), new Map());
        if (decision.action !== "repair") throw new Error("expected repair");
        expect(decision.catalog.x_ollama.models_hash).toBe(costless.x_ollama.models_hash);
        expect(decision.catalog.x_ollama.generated_at).toBe(costless.x_ollama.generated_at);
    });

    test("identical rates with an up-to-date catalog skip entirely", () => {
        const previous = pricingDoc({ "glm-5.3": standard });
        const decision = refreshDecision(previous, upToDate, new Map([["glm-5.3", standard]]), new Map());
        expect(decision.action).toBe("skip");
    });

    test("a changed standard rate publishes both artifacts", () => {
        const previous = pricingDoc({ "glm-5.3": standard });
        const decision = refreshDecision(
            previous,
            costless,
            new Map([["glm-5.3", { input: 2, output: 6, cache_read: 0.3 }]]),
            new Map(),
        );
        expect(decision.action).toBe("publish");
    });

    test("peak rates: publish adds x_ollama, removal publishes without it", () => {
        const previous = pricingDoc({ "glm-5.3": standard });
        const withPeak = refreshDecision(
            previous,
            costless,
            new Map([["glm-5.3", standard]]),
            new Map([["glm-5.3", peak]]),
            { window: "12:00-18:00 UTC" },
        );
        expect(withPeak.action).toBe("publish");
        if (withPeak.action === "publish") expect(withPeak.pricing.x_ollama?.models["glm-5.3"]).toEqual(peak);

        const withoutPeak = refreshDecision(
            pricingDoc({ "glm-5.3": standard }, { peak_window: "12:00-18:00 UTC", models: { "glm-5.3": peak } }),
            costless,
            new Map([["glm-5.3", standard]]),
            new Map(),
        );
        expect(withoutPeak.action).toBe("publish");
        if (withoutPeak.action === "publish") expect(withoutPeak.pricing.x_ollama).toBeUndefined();
    });

    test("stale peak_cost is cleaned in the repair branch", () => {
        // The rate card stopped peak-pricing glm-5.3: the authoritative empty
        // peak map strips the leftover peak_cost even though the rates are
        // otherwise unchanged.
        const spec = ModelSchema.parse({
            ...model,
            x_ollama: {
                ...model.x_ollama,
                peak_cost: peak,
            },
        });
        const catalogWithStalePeak = buildCatalogDoc({
            modelsHash: "a".repeat(64),
            specs: [spec],
            costs: new Map(),
        });
        const previous = pricingDoc({ "glm-5.3": standard });
        const decision = refreshDecision(previous, catalogWithStalePeak, new Map([["glm-5.3", standard]]), new Map());
        expect(decision.action).toBe("repair");
        if (decision.action === "repair")
            expect(decision.catalog.provider.models["glm-5.3"]?.x_ollama.peak_cost).toBeUndefined();
    });

    test("a new model in the rate card publishes", () => {
        const previous = pricingDoc({ "glm-5.3": standard });
        const decision = refreshDecision(
            previous,
            costless,
            new Map([
                ["glm-5.3", standard],
                ["glm-5.3-flash", { input: 0.15, output: 0.5, cache_read: 0.03 }],
            ]),
            new Map(),
        );
        expect(decision.action).toBe("publish");
    });
});
