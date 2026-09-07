# src/extract/

## Responsibility

Structured-output LLM client for extraction tasks: turn free text (e.g. the pricing page markdown) into schema-validated JSON using Ollama Cloud, failing the run on any contract violation.

## Design

- **Dual schema grounding:** the JSON Schema (zod → `z.toJSONSchema(schema, {target: "draft-7", io: "input"})`) is passed both in the `format` field of the chat request and rendered into the system prompt (`Respond with ONLY a JSON object matching this JSON Schema...`) — docs say schema-in-prompt grounds the response.
- **Fail-loud validation:** `JSON.parse` of the response content (a SyntaxError is a provider contract break) followed by `schema.parse` (zod backstop for endpoints that ignore structured outputs). No silent retries, no lenient parsing.
- Exported function:
  - `extractJson<S extends z.ZodType>(schema: S, instructions: string, user: string, impl?: FetchImpl): Promise<z.infer<S>>` — generic over the zod schema so callers get typed output; `impl` is the same fetch test seam as `src/lib/http.ts`.
- Configuration: model from `OLLAMA_EXTRACT_MODEL` env, default `glm-5.3-flash`; requires `OLLAMA_API_KEY` (throws if unset); deterministic output via `options: {temperature: 0}`, `stream: false`.

## Flow

Env check (`OLLAMA_API_KEY`) → build `Ollama({host: "https://ollama.com", fetch: impl})` client → derive JSON Schema from the zod schema → `client.chat` with system message (instructions + schema) and user message (the text to extract from) → take `response.message.content` (throws if missing) → `JSON.parse` → `zod` `schema.parse` → return the typed value. Any failure aborts the caller's run before anything is written.

## Integration

- Consumed by: `src/catalog/extract-rates.ts` (imports `extractJson`; injects its own `RateCall` default for snapshot testing of the prompt).
- Depends on: `ollama` JS client, `zod`, `FetchImpl` type from `src/lib/http.ts`; runtime env `OLLAMA_API_KEY`, `OLLAMA_EXTRACT_MODEL`; remote endpoint `https://ollama.com/api/chat` (chat URL constant lives in `src/lib/ollama.ts`).