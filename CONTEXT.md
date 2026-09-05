# Context

This repo publishes two artifacts for jsDelivr consumers: `catalog.json` (models.dev-shaped) and `pricing.json` (the rate card alone). No library runs at read time; the artifacts are the API.

## Vocabulary

**Model list.** The response of `GET https://ollama.com/v1/models`: an array of `{ id, created }`. Everything else is derived from it.

**models_hash.** SHA-256 over the sorted `id:created` pairs of the model list. Stored under `catalog.json` `x_ollama.models_hash`. It gates rescraping: same hash means the list we saw last time is the list we see now.

**Hash-gated pipeline.** `update-catalog` fetches the model list, compares its hash against the published artifact, and rebuilds only when the list changed, the artifact is older than a week, or `--force` was passed (`decideRebuild` in `src/catalog/gate.ts`). `check` mode answers one question, "is the catalog current with the list we saw?", with exit codes only.

**Spec sweep.** For every listed id, `POST /api/show` returns capabilities and model_info. The context length is found by key suffix (`*.context_length`) because the keys are architecture-prefixed.

**Output-limit probe.** `/api/show` does not expose the max output tokens. `POST /api/chat` with an oversized `num_predict` is rejected before any generation with an error body that names the cap (`model's maximum output tokens (N)`). The probe therefore costs no tokens. It reads a 400 body, which is why the transport has `fetchResponse` (no-2xx is data, not failure). Auth is optional for this call: with no `OLLAMA_API_KEY` the probe fails with a 401 and the run aborts.

**Rate card.** `ollama.com/pricing` is server-rendered HTML. The scraper keeps the `section#model-pricing` skeleton, converts its tables to markdown, and reads the peak window text deterministically. The LLM (glm-5.3-flash in JSON mode) only turns table cells into JSON; zod validates; the DOM row counts are the completeness check. A peak table without its window paragraph aborts the run instead of publishing a rate card that would diverge from the catalog. The prompt lives in `src/catalog/extract-rates.ts` and is under snapshot test; treat a snapshot change as a prompt change.

**Peak pricing.** A subset of models, priced 2x between 12:00 and 18:00 UTC Mon-Fri. Stored per model under `x_ollama.peak_cost`. `cost` always means the standard rate.

**Merge-back.** The two publish flows only share cost fields. Standard cost survives catalog rebuilds (previous artifacts feed the rebuild); specs survive pricing updates (pricing never touches them).

**Refresh decision.** `refreshDecision` in `src/catalog/assemble.ts`: identical rates skip the write (volatile fields like `generated_at` are excluded from the signature), a lagging catalog gets repaired without touching `pricing.json`, a rate change publishes both artifacts.

**Fail-loud coverage.** Any rate problem (unknown model, ambiguous family, missing row) aborts before anything is written. A half-published catalog is worse than no run.

**Atomic publish.** Artifacts are written to a temp file and renamed. Readers never see a partial file.

**Reasoning seed.** The effort tiers a model accepts come from models.dev, build-time only. The seed wins over the previous artifact; absence in both means the field is omitted, never guessed.

## Where things live

- `src/catalog/schema.ts` — the zod schemas, single source of truth for both artifact shapes (JSON schemas in `schemas/` are generated from them).
- `src/catalog/assemble.ts` — build, merge-back, refresh decision, publish, loaders.
- `src/catalog/gate.ts` — the rebuild decision, pure and tested.
- `src/catalog/extract-rates.ts` — rate-card prompt and completeness checks.
- `src/catalog/resolve-rates.ts` — rate rows to model ids (exact, then unique family; ambiguity throws).
- `src/sources/` — one module per upstream (models API, show endpoint, pricing page, models.dev).
- `src/lib/http.ts` — transport (`fetchResponse`, `fetchText`, `fetchJson`); `src/lib/ollama.ts` — chat URL and optional auth header.
- `tests/fixtures.ts` — live captures from 2026-09-05. Update by hand when Ollama changes shapes.