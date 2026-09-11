# Repository atlas: ollama-cloud-catalog

## What this repo is

A scraper and publisher. It reads Ollama's live model list, specs, and pricing page, then publishes two static JSON artifacts for jsDelivr consumers: `catalog.json` (models.dev-shaped, with an `x_ollama` extension) and `pricing.json` (rate card only). Nothing runs at read time; the artifacts are the API.

A hash over the model list gates rescraping, cost fields survive catalog rebuilds via merge-back, specs survive pricing updates, and every publish is atomic. `CONTEXT.md` defines all of this precisely; read it before touching the pipeline.

## Entry points

- `src/update-catalog.ts` and `src/update-pricing.ts`: the two CLIs, wired through `package.json` scripts. Catalog has a check mode that answers "is the catalog current?" with exit codes only.
- `scripts/gen-schemas.ts`: renders the zod schemas to `schemas/*.schema.json` for external consumers.
- `catalog.json` / `pricing.json`: the published artifacts, committed at repo root.

## Directory map

| Directory | Responsibility | Map |
|-----------|----------------|-----|
| `src/` | Two CLI entry points that run the hash-gated pipelines and publish both artifacts. | [codemap](src/codemap.md) |
| `src/catalog/` | Core domain layer: zod schemas, build, merge-back, refresh decision, atomic publish, rate resolution. | [codemap](src/catalog/codemap.md) |
| `src/sources/` | Upstream adapters, one per source: models list, `/api/show`, pricing HTML, models.dev. | [codemap](src/sources/codemap.md) |
| `src/lib/` | Shared plumbing: HTTP transport, chat endpoint/auth, artifact identity and atomic write, id parsing. | [codemap](src/lib/codemap.md) |
| `src/extract/` | Structured-output LLM client: free text in, zod-validated JSON out, fail on contract violation. | [codemap](src/extract/codemap.md) |
| `scripts/` | Schema codegen (`gen-schemas.ts`), draft-7 output, commit policy. | [codemap](scripts/codemap.md) |

Not mapped (excluded by design): `tests/` (fixtures are live captures from 2026-09-05), `docs/`, `schemas/` (generated, never hand-edit).

## Rules worth knowing before you edit

- `src/catalog/schema.ts` is the single source of truth for both artifact shapes; JSON schemas are generated from it.
- The rate-extraction prompt in `src/catalog/extract-rates.ts` is under snapshot test. A snapshot change is a prompt change.
- Rate problems (unknown model, ambiguous family, missing row) abort the run. A half-published catalog is worse than no run.
