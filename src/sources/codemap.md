# src/sources/

## Responsibility

Upstream adapters, one module per source: `models-api.ts` (Ollama models list), `show.ts` (`/api/show` + output-limit probe), `pricing-page.ts` (pricing HTML scraping), `models-dev.ts` (reasoning seed). Each module owns its upstream's shape knowledge, validates live payloads defensively, and normalizes them into typed values for the catalog pipeline.

## Design

- **models-api.ts.** Wraps `GET https://ollama.com/v1/models` (`{baseUrl}/models`). Exports `fetchModelsList(baseUrl, init?, impl?) => ListedModel[]` (`{ id, created }`); throws on empty payloads, entries missing `id`/`created`, or duplicate ids.
- **show.ts.** Wraps `POST https://ollama.com/api/show` (`SHOW_URL`) and the chat-endpoint probe (`CHAT_URL` via `src/lib/ollama.ts`). Exports: `probeMaxOutput(id, impl?) => number` (sends an oversized `num_predict`, reads the cap from the 400 error body regex `model's maximum output tokens (N)`; non-2xx is data, 401 means missing `OLLAMA_API_KEY`); `fetchModelSpec(id, impl?) => Model` (capabilities → `attachment`/`reasoning`/`tool_call`, `*.context_length` suffix lookup, `general.parameter_count`, `modified_at` → `release_date`; quantization/family default to `"unknown"`, never invented; zod-validated via `ModelSchema`); `fetchAllSpecs(ids, previous, concurrency=5, impl?) => Model[]` (concurrent sweep, per-model fallback to the previous catalog entry, aborts if no prior exists; an `AuthError` such as a 401 on the probe aborts the whole sweep instead of falling back).
- **pricing-page.ts.** Wraps `GET https://ollama.com/pricing` (`PRICING_URL`). Exports: `fetchPricingHtml() => string`; `extractPricingSection(html) => string` (keeps `section#model-pricing`, strips scripts/styles/attributes, throws if absent); `extractPricingTables(html) => { standard, peak?, peakWindow? }` (tables → markdown + `rowCount` for the DOM completeness check; finds the "Peak pricing" `<h3>`, requires its window `<p>`; missing window text aborts).
- **models-dev.ts.** Wraps `GET https://models.dev/api.json` (`MODELS_DEV_URL`), provider entry `ollama-cloud`. Exports: `fetchReasoningSeed() => Map<string, string[]> | undefined` (best-effort; outage/shape drift logs a warning and returns `undefined` rather than blocking a rebuild); `seedReasoningOptions(seed, id) => string[] | undefined` (exact id, then `familyOf(id)` fallback); `reasoningOptionsOf(entry)` (filters `reasoning_options` with `type === "effort"`).

## Flow

1. **Models list.** `fetchModelsList` issues a `fetchJson` GET; only `data[].id`/`created` are kept; the sorted `id:created` pairs feed `models_hash`.
2. **Specs.** For each id, `fetchModelSpec` POSTs `/api/show` (no auth), maps capabilities/model_info into a `Model`, then calls `probeMaxOutput` for `limit.output` (POST `/api/chat`, rejected pre-generation, token-free, 401 throws `AuthError`). `fetchAllSpecs` runs the sweep at concurrency 5 with previous-artifact fallback; `AuthError` aborts the sweep.
3. **Pricing.** `fetchPricingHtml` fetches the server-rendered page; `extractPricingTables` converts DOM tables to markdown (LLM, in `src/catalog/extract-rates.ts`, only turns cells into JSON; zod validates; row counts + peak window text come from the DOM, deterministically).
4. **models.dev.** `fetchReasoningSeed` reads `ollama-cloud` models' effort tiers build-time only; the seed wins over the previous artifact, absence omits the field.

## Integration

- Consumed by: `src/catalog` (`assemble.ts` uses `seedReasoningOptions`; `extract-rates.ts` uses the `PricingTable` type) and the entrypoints `src/update-catalog.ts` / `src/update-pricing.ts`; `src/extract` only touches `FetchImpl` from `src/lib/http.ts`, not this directory.
- Depends on: `src/lib/http.ts` (`fetchJson`, `fetchText`, `fetchResponse`, `mapWithConcurrency`, `FetchImpl`), `src/lib/ollama.ts` (`CHAT_URL`, `ollamaAuthHeader`), `src/lib/ids.ts` (`displayName`, `familyOf`), `src/catalog/schema.ts` (`ModelSchema`, `Model`), `cheerio`.
