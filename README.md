# ollama-cloud-catalog

A models.dev-shaped model catalog for Ollama Cloud, maintained by GitHub
Actions. Two artifacts at the repo root:

- **`catalog.json`** — one provider document (`provider.models` keyed by
  model id) with the fields the [models.dev](https://models.dev) standard
  defines: `cost` (USD per million tokens), `limit`, capabilities
  (`attachment`/`reasoning`/`tool_call`), `modalities`, `release_date`.
  Ollama-specific metadata (quantization, family, parameter count) rides
  under the per-model `x_ollama` extension; the hash-gate state under the
  top-level one.
- **`pricing.json`** — the rate card alone (cost per model), for consumers
  that only want pricing.

JSON Schemas for both live in [`schemas/`](schemas/), rendered from the
canonical zod definitions in `src/catalog/schema.ts` (`bun run gen-schemas`).

## How it runs

| Workflow | Trigger | What it does |
|---|---|---|
| `update-catalog` | manual / 10-min cron via API | Hash-gates on `/v1/models`; scrapes specs only on change (or weekly staleness) |
| `update-pricing` | Mondays 06:00 UTC / manual | Scrapes the rate card with `glm-5.3-flash` structured outputs |
| `update-capabilities` | manual only | `--force` spec re-extraction when Ollama quietly upgrades a model |

Sources, in order of trust:

1. `GET /v1/models` — the model list; sha256 of its `id:created` pairs is the
   change gate (stored in `catalog.json` → `x_ollama.models_hash`).
2. `POST /api/show` — capabilities, context length, quantization,
   parameter count, release date (`modified_at`).
3. `POST /api/chat` output-limit probe — an oversized `num_predict` is
   rejected with the model's real output cap before any generation, so the
   probe costs no tokens:
   `"max_tokens (...) exceeds model's maximum output tokens (1048576) ..."`.
4. `ollama.com/pricing` — cheerio pre-extracts `section#model-pricing`, then
   glm-5.3-flash extracts the rate rows with a zod-derived JSON schema.
   Rows link `/library/<id>`, so ids come straight from the page.

Everything is fail-loud: a missing `/api/show` response falls back to the
previous catalog entry, and **any pricing coverage problem** (unknown rate,
ambiguous family, catalog model without a rate) aborts the run before
anything is written. Cost fields survive catalog rebuilds; spec fields
survive pricing updates.

## Local usage

```sh
bun install
bun run check            # exit 0 if the catalog is up to date
OLLAMA_API_KEY=... bun run update            # rebuild specs (hash-gated)
OLLAMA_API_KEY=... bun run update-pricing    # refresh cost fields
bun test && bun run typecheck
```

Consumers (e.g. the [opencode-ollama-cloud](https://github.com/srnoob2570/opencode-ollama-cloud)
plugin) read the artifacts from jsDelivr or raw GitHub — this repo has no
runtime library.

## Layout

```
src/
  update-catalog.ts     hash-gated pipeline entry
  update-pricing.ts     rate-card pipeline entry
  catalog/schema.ts     zod: canonical schemas (docs + LLM contract)
  catalog/assemble.ts   artifact building, cost merge, atomic publish
  catalog/resolve-rates.ts  rate→model resolution + coverage (ported)
  sources/models-api.ts     /v1/models
  sources/show.ts           /api/show + output-limit probe
  sources/pricing-page.ts   pricing HTML → cheerio
  extract/ai.ts             Ollama Cloud structured outputs
scripts/gen-schemas.ts    renders schemas/*.schema.json
```