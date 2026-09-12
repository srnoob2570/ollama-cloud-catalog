# ADR 0005: publishing runs as Dokploy schedule jobs

Accepted 2026-09-12

## Context

Artifacts were refreshed by three GitHub Actions workflows (`update-catalog`, `update-pricing`, `update-capabilities`), but GitHub's `schedule` trigger proved unreliable, so runs were fired from a self-hosted runner's crontab via `workflow_dispatch`. That runner and its external crontab are the only thing keeping the artifacts current, and when they fail there is no obvious signal. The pipelines themselves are sound: cwd-relative artifact paths, atomic writes, fail-loud coverage. Only the mechanism that executes them and commits the result needs replacing. A VPS running Dokploy is available.

## Decision

The repo ships a `Dockerfile` and `docker/run-pipeline.sh`. Dokploy builds it as an Application whose `CMD` is `sleep infinity`, so the container stays alive as the exec target for Dokploy Schedule Jobs. `run-pipeline <check|update|force|pricing>` clones `main` fresh on every run, installs with `--frozen-lockfile`, runs the matching bun entry point under `timeout 900`, and commits `catalog.json` and `pricing.json` only when they changed. `flock` serializes runs because catalog and pricing both rewrite `catalog.json` through merge-back. Authentication is a fine-grained PAT passed as `GITHUB_TOKEN`; git reads it through `GIT_ASKPASS`, so it never appears in process arguments or error output. Commit messages keep the `chore: refresh ...` convention, and a successful push purges both files from jsDelivr.

A fresh clone per run means pipeline code is always current `main`, so code changes need no redeploy. Only changes to the `Dockerfile` or `run-pipeline.sh` require one.

## Consequences

Scheduling, per-run logs, and container lifecycle come from Dokploy; there is no runner and no external crontab. Failed runs are visible in the Dokploy schedule logs, but unlike Actions there is no notification by default. The PAT expires and must be rotated before it does. Publishing now depends on the VPS being up, which is the same machine that hosted the runner. `ci.yml` keeps validating every artifact push on ubuntu-latest, so the publishing path still runs the test suite per commit.
