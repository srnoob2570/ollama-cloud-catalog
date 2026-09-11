# src/

## Responsibility
Two CLI entry points that publish the repo's artifacts (`catalog.json`, `pricing.json`):
- `update-catalog.ts` runs the hash-gated spec pipeline, rebuilding the models.dev-shaped catalog from the live model list and preserving cost fields from the previous artifact (merge-back).
- `update-pricing.ts` scrapes `ollama.com/pricing`, extracts rate cards with the LLM, refreshes cost in `catalog.json`, and publishes `pricing.json`.

## Design
- Thin top-level orchestration: fetch upstreams (`src/sources/`), delegate decisions to pure helpers (`gate.ts` `decideRebuild`, `assemble.ts` `refreshDecision`), publish atomically.
- Fail-loud: coverage problems, missing catalog, or an ambiguous rate family abort before any write (exit 1).
- Exit codes are the `check` mode contract; all progress goes to stdout, problems to stderr.

## Flow
`update-catalog.ts`, run as `bun src/update-catalog.ts <check|update> [--force]` (bad mode → usage + exit 2):
1. Load published catalog, fetch `GET https://ollama.com/v1/models`, compute `modelsHash`.
2. `check`: print `catalog is up to date` / `catalog is outdated`; exit 0 when `x_ollama.models_hash` matches the live hash, else 1.
3. `update`: `decideRebuild` decides. `skip` prints "nothing to do" and exits 0; otherwise the script logs the reason (`force` | `stale` | `no-previous` | `changed`) and proceeds.
4. Rebuild: `fetchReasoningSeed` (models.dev), `fetchAllSpecs` (`POST /api/show` per id + output-limit probe via `/api/chat`), `buildCatalogDoc` merges previous costs/peak costs/reasoning options, `publishCatalog`.
5. Warns on models without cost, prompting `update-pricing`.

`update-pricing.ts` takes no flags:
1. `fetchPricingHtml` → `extractPricingTables` (cheerio on `section#model-pricing`; tables to markdown, deterministic peak-window text).
2. `extractRates` (glm-5.3-flash, JSON-schema format, zod-validated) → `resolveRates` for standard and peak rates; any problem exits 1.
3. `refreshDecision`: `skip` → exit 0 (no write); `repair` → republish `catalog.json` only; `change` → publish both artifacts.

## Integration
- Run via npm scripts: `update`, `check`, `update-pricing` (`package.json`); wired into GitHub Actions.
- Shared modules: `catalog/assemble.ts` (loaders/publishers), `catalog/gate.ts`, `catalog/extract-rates.ts`, `catalog/resolve-rates.ts`, `sources/*`, `lib/*`.
- `OLLAMA_API_KEY` is required by the output-limit probe; without it the probe 401s and the run aborts.
