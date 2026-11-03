// Structured-output client for OpenAI-compatible gateways. The default chain
// is Google Gemini's free tier (its OpenAI compatibility endpoint) with Kilo's
// free pool as a no-key fallback. The JSON Schema rides in the prompt and, when
// the attempt declares it, in `response_format`; zod validation remains the
// backstop. No silent retries: each model gets one attempt, and a failure moves
// to the next model with a log line. An incomplete extraction is rejected by
// the caller's `check` hook so it can fall through too.
import { fetchResponse, type FetchImpl } from "../lib/http.ts";
import { z } from "zod";

const DEFAULT_PRIMARY_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai";
const DEFAULT_PRIMARY_MODEL = "gemini-3.8-flash";
const DEFAULT_PRIMARY_FORMAT = "json_schema";
const DEFAULT_FALLBACK_BASE_URL = "https://ai-gateway.kilo.ai/api/v1";
const DEFAULT_FALLBACK_MODEL = "reflection/beam-free";
const DEFAULT_FALLBACK_FORMAT = "json_object";
const DEFAULT_TIMEOUT_MS = 120_000;
const GOOGLE_HOST = "generativelanguage.googleapis.com";

export type ResponseFormat = "json_schema" | "json_object" | "none";

type Attempt = {
    baseUrl: string;
    model: string;
    apiKey: string | undefined;
    format: ResponseFormat;
};

type ExtractOptions<S extends z.ZodType> = {
    impl?: FetchImpl;
    check?: (value: z.infer<S>) => void;
};

const env = (name: string): string | undefined => {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
};

const formatOf = (value: string | undefined, fallback: ResponseFormat): ResponseFormat => {
    if (value === "json_schema" || value === "json_object" || value === "none") return value;
    if (value) throw new Error(`invalid extraction format: ${value} (expected json_schema, json_object or none)`);
    return fallback;
};

// The chain is read at call time so tests and operators can override it
// without a module reload. A fallback model of "off"/"none" disables it.
export function extractionChain(): Attempt[] {
    const chain: Attempt[] = [
        {
            baseUrl: env("EXTRACT_PRIMARY_BASE_URL") ?? DEFAULT_PRIMARY_BASE_URL,
            model: env("EXTRACT_PRIMARY_MODEL") ?? DEFAULT_PRIMARY_MODEL,
            apiKey: env("EXTRACT_PRIMARY_API_KEY") ?? env("GEMINI_API_KEY"),
            format: formatOf(env("EXTRACT_PRIMARY_FORMAT"), DEFAULT_PRIMARY_FORMAT),
        },
    ];
    const fallbackModel = env("EXTRACT_FALLBACK_MODEL") ?? DEFAULT_FALLBACK_MODEL;
    if (fallbackModel !== "off" && fallbackModel !== "none") {
        chain.push({
            baseUrl: env("EXTRACT_FALLBACK_BASE_URL") ?? DEFAULT_FALLBACK_BASE_URL,
            model: fallbackModel,
            apiKey: env("EXTRACT_FALLBACK_API_KEY") ?? env("KILO_API_KEY"),
            format: formatOf(env("EXTRACT_FALLBACK_FORMAT"), DEFAULT_FALLBACK_FORMAT),
        });
    }
    return chain;
}

const requiresKey = (attempt: Attempt): boolean => attempt.baseUrl.includes(GOOGLE_HOST);

// Keywords the strict JSON-Schema modes of the current providers reject. The
// original schema still goes into the prompt; this sanitized copy is only for
// `response_format`, where the provider validates it. zod keeps the constraints.
const UNSUPPORTED_KEYWORDS = new Set([
    "$schema",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "pattern",
    "format",
]);

function toStrictJsonSchema(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(toStrictJsonSchema);
    if (!value || typeof value !== "object") return value;
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(source)) {
        if (UNSUPPORTED_KEYWORDS.has(key)) continue;
        out[key] = toStrictJsonSchema(child);
    }
    if (out.type === "object" && out.properties && typeof out.properties === "object") {
        out.additionalProperties = false;
    }
    return out;
}

const contentOf = (payload: unknown): string | undefined => {
    if (!payload || typeof payload !== "object") return undefined;
    const choices = (payload as { choices?: unknown }).choices;
    if (!Array.isArray(choices) || choices.length === 0) return undefined;
    const message = (choices[0] as { message?: { content?: unknown } } | undefined)?.message;
    const content = message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        const text = content
            .map((part) =>
                part && typeof part === "object" && "text" in part
                    ? String((part as { text?: unknown }).text ?? "")
                    : "",
            )
            .join("");
        return text || undefined;
    }
    return undefined;
};

const timeoutMs = (): number => {
    const configured = Number(process.env.EXTRACT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
};

async function callAttempt(
    attempt: Attempt,
    system: string,
    user: string,
    strictSchema: unknown,
    impl: FetchImpl,
): Promise<unknown> {
    const url = `${attempt.baseUrl.replace(/\/+$/, "")}/chat/completions`;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (attempt.apiKey) headers.authorization = `Bearer ${attempt.apiKey}`;
    const responseFormat =
        attempt.format === "json_schema"
            ? {
                  type: "json_schema",
                  json_schema: { name: "extraction", schema: strictSchema, strict: true },
              }
            : attempt.format === "json_object"
              ? { type: "json_object" }
              : undefined;

    const { status, text } = await fetchResponse(
        url,
        {
            method: "POST",
            headers,
            body: JSON.stringify({
                model: attempt.model,
                messages: [
                    { role: "system", content: system },
                    { role: "user", content: user },
                ],
                temperature: 0,
                max_tokens: 8192,
                stream: false,
                ...(responseFormat ? { response_format: responseFormat } : {}),
            }),
            signal: AbortSignal.timeout(timeoutMs()),
        },
        impl,
    );
    if (!(status >= 200 && status < 300)) throw new Error(`HTTP ${status}: ${text.slice(0, 300)}`);

    let payload: unknown;
    try {
        payload = JSON.parse(text);
    } catch {
        throw new Error(`response is not valid JSON: ${text.slice(0, 200)}`);
    }
    const content = contentOf(payload);
    if (!content) throw new Error("chat response has no message content");
    try {
        return JSON.parse(content);
    } catch {
        throw new Error(`message content is not valid JSON: ${content.slice(0, 200)}`);
    }
}

export async function extractJson<S extends z.ZodType>(
    schema: S,
    instructions: string,
    user: string,
    options: ExtractOptions<S> = {},
): Promise<z.infer<S>> {
    const impl = options.impl ?? fetch;
    const chain = extractionChain();
    // A missing key on a key-required provider is a configuration error, not a
    // transient provider failure: abort before any request instead of silently
    // degrading to the fallback.
    for (const attempt of chain) {
        if (requiresKey(attempt) && !attempt.apiKey)
            throw new Error(`GEMINI_API_KEY is not set (required by ${attempt.model})`);
    }

    const jsonSchema = z.toJSONSchema(schema, { target: "draft-7", io: "input" });
    const strictSchema = toStrictJsonSchema(jsonSchema);
    const system = `${instructions}\nRespond with ONLY a JSON object matching this JSON Schema (no markdown, no fences):\n${JSON.stringify(jsonSchema)}`;
    const errors: Error[] = [];

    for (const attempt of chain) {
        try {
            const parsed = await callAttempt(attempt, system, user, strictSchema, impl);
            const value = schema.parse(parsed);
            options.check?.(value);
            console.log(`extraction via ${attempt.model}`);
            return value;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.warn(`! extraction attempt failed (${attempt.model}): ${message}`);
            errors.push(new Error(`${attempt.model}: ${message}`, { cause: err }));
        }
    }

    throw new AggregateError(
        errors,
        `all extraction models failed: ${chain.map((attempt) => attempt.model).join(", ")}`,
    );
}
