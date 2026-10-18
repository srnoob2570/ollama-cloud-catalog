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

## Preferences

- None recorded yet.
