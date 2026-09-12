// Build-time seed for the metadata fields no Ollama endpoint exposes: the
// reasoning-effort tiers a model accepts, plus description and temperature.
// models.dev is the ecosystem's canonical dataset (the old repo's updater
// seeded from it too); it is read here, at update time only. The published
// artifact stays dependency-free. Absence is the honest answer when neither
// the seed nor the previous artifact has the data: the field is simply
// omitted, never guessed.
import { fetchJson } from "../lib/http.ts";
import { familyOf } from "../lib/ids.ts";

export const MODELS_DEV_URL = "https://models.dev/api.json";

type SeedModel = {
    reasoning_options?: { type?: string; values?: unknown }[];
    description?: string;
    temperature?: boolean;
};

export type SeedEntry = {
    reasoning_options?: string[];
    description?: string;
    temperature?: boolean;
};

export function reasoningOptionsOf(entry: SeedModel): string[] | undefined {
    const values = (entry.reasoning_options ?? [])
        .filter((o) => o?.type === "effort")
        .flatMap((o) => (Array.isArray(o.values) ? o.values : []))
        .filter((v): v is string => typeof v === "string");
    return values.length > 0 ? values : undefined;
}

// Normalize one raw models.dev entry. Fields are kept only when well formed;
// absent fields stay absent (never `undefined`) so the merge-back spread
// pattern keeps working under exactOptionalPropertyTypes.
export function seedEntryOf(entry: SeedModel): SeedEntry {
    const reasoning_options = reasoningOptionsOf(entry);
    return {
        ...(reasoning_options ? { reasoning_options } : {}),
        ...(typeof entry.description === "string" && entry.description.length > 0
            ? { description: entry.description }
            : {}),
        ...(typeof entry.temperature === "boolean" ? { temperature: entry.temperature } : {}),
    };
}

// Best-effort by design: a models.dev outage or shape drift must not block a
// catalog rebuild; the updater falls back to the previous artifact's values.
export async function fetchModelsDevSeed(): Promise<Map<string, SeedEntry> | undefined> {
    try {
        const doc = await fetchJson<Record<string, { models?: Record<string, SeedModel> }>>(MODELS_DEV_URL);
        const models = doc["ollama-cloud"]?.models;
        if (!models) throw new Error("no ollama-cloud provider entry");
        const seed = new Map<string, SeedEntry>();
        for (const [id, entry] of Object.entries(models)) {
            const normalized = seedEntryOf(entry);
            if (Object.keys(normalized).length > 0) seed.set(id, normalized);
        }
        if (seed.size === 0) throw new Error("no seedable metadata entries");
        return seed;
    } catch (err) {
        console.warn(
            `! models.dev seed unavailable (${err instanceof Error ? err.message : err}); seeded metadata will come from the previous artifact or be omitted`,
        );
        return undefined;
    }
}

// models.dev indexes some models without their tag ('deepseek-v4-flash' for
// 'deepseek-v4-flash:0731'), so exact id first, family second.
export const seedEntry = (seed: Map<string, SeedEntry>, id: string): SeedEntry | undefined =>
    seed.get(id) ?? seed.get(familyOf(id));
