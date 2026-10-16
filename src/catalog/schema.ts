// Canonical schemas for the published artifacts, following the models.dev
// standard (github.com/sst/models.dev, packages/core/src/schema.ts shape):
// one provider document whose models carry cost, limit, capabilities and
// modalities. Ollama-specific metadata that the standard does not define
// lives under the `x-ollama` extension key (JSON Schema extension naming).
//
// These zod schemas are the single source of truth: `scripts/gen-schemas.ts`
// renders them to schemas/*.schema.json for external consumers, and the
// pricing extractor reuses the rate schema as the LLM's structured-output
// contract. No hand-maintained JSON schema, no regex.
import { z } from "zod";

// models.dev cost: US dollars per MILLION tokens (matches ollama.com/pricing's
// "per million tokens" card 1:1, with no conversion anywhere in the pipeline).
// output is absent when the page prices input only (decision models, first
// seen 2026-10-16: clef's Output cell is '-'): absence, never a guess.
export const CostSchema = z.object({
    input: z.number().positive(),
    output: z.number().positive().optional(),
    cache_read: z.number().positive().optional(),
    cache_write: z.number().positive().optional(),
});

export const LimitSchema = z.object({
    context: z.number().int().positive(),
    output: z.number().int().positive().optional(),
});

export const ModalitiesSchema = z.object({
    input: z.array(z.enum(["text", "image", "audio", "video", "pdf"])),
    output: z.array(z.enum(["text", "image", "audio", "video", "pdf"])),
});

export const OllamaMetaSchema = z.object({
    quantization: z.string().min(1),
    ollama_family: z.string().min(1),
    // Omitted when Ollama reports 0. Some servers (minimax-m3) declare
    // nothing, and the canonical answer for no source is absence, not a guess.
    parameter_count: z.number().int().positive().optional(),
    // Present only on models the rate card lists under peak pricing
    // (12:00-18:00 UTC Mon-Fri on ollama.com); `cost` stays the standard rate.
    peak_cost: CostSchema.optional(),
    // The "(Off-Peak)" mirror rate (2026-10-16: half price outside 12:00-18:00
    // UTC on weekdays and all day on weekends); `cost` stays the listed rate.
    off_peak_cost: CostSchema.optional(),
    // Reasoning-effort tiers the model accepts (ollama.com/v1 maps
    // reasoning_effort onto its native think level). Not exposed by any Ollama
    // endpoint; confirmed live on 2026-09-12 as the same four tiers for every
    // cataloged model (see src/sources/reasoning-overrides.ts).
    reasoning_options: z.array(z.string()).optional(),
});

// Statuses follow models.dev; a healthy cataloged model simply omits it.
export const StatusSchema = z.enum(["alpha", "beta", "deprecated"]);

export const ModelSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    attachment: z.boolean(),
    reasoning: z.boolean(),
    tool_call: z.boolean(),
    temperature: z.boolean().optional(),
    cost: CostSchema.optional(),
    limit: LimitSchema,
    modalities: ModalitiesSchema.optional(),
    release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: StatusSchema.optional(),
    description: z.string().optional(),
    x_ollama: OllamaMetaSchema,
});

export const ProviderSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    env: z.array(z.string()),
    npm: z.string(),
    doc: z.string(),
    models: z.record(z.string(), ModelSchema),
});

export const CatalogDocSchema = z.object({
    $schema: z.string(),
    provider: ProviderSchema,
    x_ollama: z.object({
        generated_at: z.string().datetime({ offset: true }),
        models_hash: z.string().regex(/^[0-9a-f]{64}$/),
        sources: z.object({
            models: z.string(),
            show: z.string(),
        }),
    }),
});

export const PricingDocSchema = z.object({
    $schema: z.string(),
    provider: z.string().min(1),
    generated_at: z.string().datetime({ offset: true }),
    source: z.string(),
    models: z.record(z.string(), CostSchema),
    // Time-varying rate classes, each with the window sentence read from the
    // pricing page (the LLM never supplies window text). `peak_window`/`models`
    // are the historical peak block; `off_peak_window`/`off_peak_models` are
    // the inline mirror rows the card grew on 2026-10-16.
    x_ollama: z
        .object({
            peak_window: z.string().min(1).optional(),
            models: z.record(z.string(), CostSchema).optional(),
            off_peak_window: z.string().min(1).optional(),
            off_peak_models: z.record(z.string(), CostSchema).optional(),
        })
        .optional(),
});

// The extraction contract handed to the LLM (glm-5.3-flash via Ollama Cloud,
// JSON mode): the standard rate card rows plus the peak-pricing rows (empty
// when the page has no peak table). Anchors and money-string parsing are the
// LLM's job; ours is validating the shape, the per-table row counts and the
// catalog coverage.
const RateRowsSchema = z.array(
    z.object({
        model: z
            .string()
            .min(1)
            .describe("the model id shown as the row link's text, e.g. 'glm-5.3' or 'gpt-oss:120b'"),
        input: z.number().positive().describe("input USD per million tokens"),
        cached_input: z
            .number()
            .positive()
            .nullable()
            .describe("cached input USD per million tokens; null when the cell is '-'"),
        output: z.number().positive().nullable().describe("output USD per million tokens; null when the cell is '-'"),
    }),
);

export const RateCardExtractionSchema = z.object({
    rates: RateRowsSchema.min(1),
    peak_rates: RateRowsSchema,
});

export type RateRow = z.infer<typeof RateRowsSchema.element>;
export type RateCardExtraction = z.infer<typeof RateCardExtractionSchema>;
export type Cost = z.infer<typeof CostSchema>;
export type Model = z.infer<typeof ModelSchema>;
export type CatalogDoc = z.infer<typeof CatalogDocSchema>;
export type PricingDoc = z.infer<typeof PricingDocSchema>;
