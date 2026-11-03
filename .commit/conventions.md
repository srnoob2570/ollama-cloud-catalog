# Commit conventions

## Why

- No changelog exists at the repo root (no `CHANGELOG*`, `CHANGES*`,
  `HISTORY*`), so commits extend nothing and a changelog is never created
  here; the two published artifacts (`catalog.json`, `pricing.json`) are the
  product.

## Gotchas

- Commit style: Conventional Commits in English **without scope** — `fix:`,
  `feat:`, `chore:`, `ci:`, `test:` (see `git log`). The Dokploy pipeline
  writes its own `chore: refresh ...` / `chore: force-refresh ...` commits.
- A new spec field captured from an endpoint (e.g. `x_ollama.decision`,
  2026-10-17) is invisible to the hash gate: an unchanged model list skips
  the catalog rebuild, so the field never lands and downstream pricing that
  reads it (decision models' free output/cache as $0) silently no-ops. Fix:
  `update-catalog update --force`, then `update-pricing` — the cost diff
  then counts as a rate change and republishes both artifacts.
- The scheduled pipeline commits artifacts and pushes straight to
  `origin/main`, so local checkouts drift (ahead/behind). Rebase on origin
  before pushing anything local; pipeline commits usually touch only
  `catalog.json`/`pricing.json`.
- Pre-commit hooks: `prettier --write` on staged ts/tsx only (settings in
  `.prettierrc.json`), repo-wide `bun run typecheck`, trailing-whitespace and
  end-of-file fixers. If a hook rewrites a file the commit aborts: re-stage
  the file and retry without extra flags.
- `bunx prettier --check README.md` fails on the pristine tree (pre-existing;
  markdown is outside the hook's ts/tsx net). Do not "fix" it inside an
  unrelated commit.
- `extractJson` tests must clear `GEMINI_API_KEY`, `KILO_API_KEY` and the
  `EXTRACT_*` overrides before each case: Bun loads `.env`, and a developer's
  real key would otherwise leak into the request assertions. The provider
  chain is read at call time, so tests can set env per case.
- Pricing extraction needs `GEMINI_API_KEY` (`pricing`, and `update` because it
  may chain pricing); `OLLAMA_API_KEY` still gates `update`/`force` through the
  output-limit probe in `src/sources/show.ts`.
- Gemini 3.8 Flash and 3.6 Flash returned 503 high-demand during the
  2026-11-03 migration; the default extraction model is
  `gemini-3.5-flash-lite`, which extracted the live 25-row card in ~3.4s.
  Override with `EXTRACT_PRIMARY_MODEL` if it degrades.

## Preferences

- None recorded yet.
