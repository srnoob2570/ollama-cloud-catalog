// Build-time seed for the one metadata field no Ollama endpoint exposes:
// the reasoning-effort tiers a model accepts. models.dev is the ecosystem's
// canonical dataset (the old repo's updater seeded from it too); it is read
// here, at update time only. The published artifact stays dependency-free.
// Absence is the honest answer when neither the seed nor the previous
// artifact has the data: the field is simply omitted, never guessed.
import { fetchJson } from "../lib/http.ts";
import { familyOf } from "../lib/ids.ts";

export const MODELS_DEV_URL = "https://models.dev/api.json";

type SeedModel = { reasoning_options?: { type?: string; values?: unknown }[] };

export function reasoningOptionsOf(entry: SeedModel): string[] | undefined {
    const values = (entry.reasoning_options ?? [])
        .filter((o) => o?.type === "effort")
        .flatMap((o) => (Array.isArray(o.values) ? o.values : []))
        .filter((v): v is string => typeof v === "string");
    return values.length > 0 ? values : undefined;
}

// Best-effort by design: a models.dev outage or shape drift must not block a
// catalog rebuild; the updater falls back to the previous artifact's values.
export async function fetchReasoningSeed(): Promise<Map<string, string[]> | undefined> {
    try {
        const doc = await fetchJson<Record<string, { models?: Record<string, SeedModel> }>>(MODELS_DEV_URL);
        const models = doc["ollama-cloud"]?.models;
        if (!models) throw new Error("no ollama-cloud provider entry");
        const seed = new Map<string, string[]>();
        for (const [id, entry] of Object.entries(models)) {
            const options = reasoningOptionsOf(entry);
            if (options) seed.set(id, options);
        }
        if (seed.size === 0) throw new Error("no reasoning_options entries");
        return seed;
    } catch (err) {
        console.warn(
            `! models.dev seed unavailable (${err instanceof Error ? err.message : err}); reasoning_options will come from the previous artifact or be omitted`,
        );
        return undefined;
    }
}

// models.dev indexes some models without their tag ('deepseek-v4-flash' for
// 'deepseek-v4-flash:0731'), so exact id first, family second.
export const seedReasoningOptions = (seed: Map<string, string[]>, id: string): string[] | undefined =>
    seed.get(id) ?? seed.get(familyOf(id));
