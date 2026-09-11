# ollama-cloud-catalog

Scraper that publishes two static artifacts (`catalog.json`, `pricing.json`) consumed from jsDelivr. There is no runtime library; the artifacts are the API.

## Commands

```sh
bun install
bun test && bun run typecheck      # local verification; no linter or formatter configured
bun run check                      # is the catalog current? exit codes only, no API key needed
OLLAMA_API_KEY=... bun run update            # hash-gated spec rebuild (hits live ollama.com)
OLLAMA_API_KEY=... bun run update-pricing    # rate-card refresh (hits live page + LLM)
bun run gen-schemas                # after editing src/catalog/schema.ts
bun test tests/pipeline.test.ts -t "name"    # single test
```

Most local work runs offline: `bun test` uses fixtures only and needs no key. Anything that touches `update` / `update-pricing` hits live endpoints and fails 401 without `OLLAMA_API_KEY`.

## Gotchas

- **Bun 1.4, TS 5.9 strict.** `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on: indexed reads are `T | undefined` and optional properties reject explicit `undefined` assignment. This bites constantly; typecheck is the only gate.
- **Non-2xx is data.** `fetchResponse` in `src/lib/http.ts` returns error bodies instead of throwing. Do not "fix" it; the output-limit probe depends on reading a 400 body.
- **The extraction prompt is under snapshot test.** The prompt in `src/catalog/extract-rates.ts` has a snapshot in `tests/`. Changing the prompt means updating the snapshot deliberately; never regenerate it to make a test pass.
- **Fail-loud coverage.** Unknown rate, ambiguous family, or catalog model without a rate aborts the run before anything is written. Do not add fallbacks that mask coverage problems. A half-published catalog is worse than no run.
- **Schema changes require codegen.** `src/catalog/schema.ts` is the single source of truth; `schemas/*.json` are generated. Hand-editing them is always wrong.
- **Merge-back reads previous artifacts.** Cost fields survive catalog rebuilds; specs survive pricing updates. The published `catalog.json`/`pricing.json` at repo root are pipeline inputs, so regenerate them via the pipelines rather than tweaking by hand.
- **Fixtures are live captures** (2026-09-05) in `tests/fixtures.ts`. Update them by hand only when Ollama changes response shapes.
- **Cron lives outside the repo.** The `schedule` triggers in the workflow YAMLs are commented out because runs fire from a self-hosted runner's crontab via `workflow_dispatch`. Do not re-enable them.
- Workflows are the only thing that commits artifacts (`chore: refresh ...`). Do not edit `catalog.json`/`pricing.json` manually.

## Repository Map

A full codemap is available at `codemap.md` in the project root.

Before working on any task, read `codemap.md` to understand:
- Project architecture and entry points
- Directory responsibilities and design patterns
- Data flow and integration points between modules

For deep work on a specific folder, also read that folder's `codemap.md`. Domain vocabulary and design decisions live in `CONTEXT.md`.
