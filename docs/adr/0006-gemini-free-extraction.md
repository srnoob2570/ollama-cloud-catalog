# ADR 0006: free extraction providers, Gemini first

Accepted 2026-11-03

## Context

The pricing pipeline extracted rate-card rows with `glm-5.3-flash` through the
`ollama` JS client `format` field against Ollama Cloud. The Ollama Cloud
subscription is ending, so the extraction needs a provider that does not
depend on it. The job runs weekly (plus the occasional chained run after a
catalog rebuild) and sends one small, public rate-card table, so throughput is
irrelevant; reliability and a free tier are what matter.

OpenCode Console's free-tier models (`glm-5.3-flash-free`,
`deepseek-v4.1-flash-free`) are not usable here: they are restricted to the
OpenCode client and return HTTP 403 to other clients, even with a Console API
key. Kilo's gateway, by contrast, serves its `:free` models anonymously.

## Decision

Extraction uses an ordered, env-configurable chain of OpenAI-compatible chat
completions endpoints:

1. **Gemini 3.8 Flash** via `https://generativelanguage.googleapis.com/v1beta/openai`
   with `GEMINI_API_KEY`. It is on Google's free tier, follows the JSON
   contract well, and is a much stronger model than the old extraction call
   needs.
2. **Kilo `reflection/beam-free`** via `https://ai-gateway.kilo.ai/api/v1`,
   anonymously (no key), as the fallback. It was validated against the live
   25-row rate card and returned every row.

Each model gets exactly one attempt. A failure — transport error, non-2xx,
empty content, invalid JSON, zod failure, or the caller's completeness check —
logs the reason and moves to the next model. If every model fails, the run
aborts with an `AggregateError` naming all of them. This is a provider
fallback, not a retry of the same call: ADR 0003's no-hidden-retries rule still
holds.

The JSON Schema goes into the prompt. For `response_format`, the client sends a
sanitized copy: `additionalProperties: false` on every object and the
keywords current providers reject (`exclusiveMinimum`, `minLength`, `format`,
etc.) removed. zod still enforces the original constraints. Formats are
per-attempt (`json_schema`, `json_object`, `none`) because providers differ:
Gemini accepts a JSON Schema, while Beam's provider rejects the strict schema
and works with `json_object`.

The completeness check lives in `extractRates` and is handed to the client as a
per-attempt hook, so a model that drops a row falls through to the next one
instead of aborting the whole chain.

Overrides (all optional): `EXTRACT_PRIMARY_BASE_URL`, `EXTRACT_PRIMARY_MODEL`,
`EXTRACT_PRIMARY_API_KEY`, `EXTRACT_PRIMARY_FORMAT`,
`EXTRACT_FALLBACK_BASE_URL`, `EXTRACT_FALLBACK_MODEL`,
`EXTRACT_FALLBACK_API_KEY`, `EXTRACT_FALLBACK_FORMAT`, `EXTRACT_TIMEOUT_MS`.
Setting `EXTRACT_FALLBACK_MODEL=off` disables the fallback. `KILO_API_KEY` is
optional and only raises Kilo's anonymous limit.

## Consequences

- The pricing job no longer needs `OLLAMA_API_KEY`; `docker/run-pipeline.sh`
  requires `GEMINI_API_KEY` for `pricing` and `update`, and keeps
  `OLLAMA_API_KEY` for `update`/`force` because of the output-limit probe.
- Free-tier quotas and model availability change. The chain is two models from
  different providers, and the env overrides allow switching without code.
- The free tiers may log or train on prompts. The only content sent is
  `ollama.com/pricing`'s public HTML, so no private data is involved.
- The `ollama` npm dependency is removed; the only remaining Ollama API call is
  the output-limit probe in `src/sources/show.ts`, which uses `fetch`.
- The output-limit probe still needs an Ollama key. Making it optional (and
  carrying the previous `limit.output` when no key is configured) is a separate
  decision, not part of this change.
