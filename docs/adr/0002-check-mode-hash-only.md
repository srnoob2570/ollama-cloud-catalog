# ADR 0002: check mode decides on the hash alone

Accepted 2026-09-05

## Context

`update-catalog check` tells CI whether the published catalog matches the current model list. The update mode also treats a week-old artifact as stale and rebuilds even when the hash matches. Unifying both modes on one decision function would give check the same staleness rule.

## Decision

`check` compares `models_hash` only: same hash is exit 0, different hash (or no artifact) is exit 1. `decideRebuild` owns staleness and is used by update mode alone. Rationale: check answers "is the catalog current with the list we saw", a factual question; staleness is an update-time policy about how far we trust the scrapes. Sharing the function would silently turn "artifact old but hash still valid" from exit 0 into exit 1, a CI-visible contract change.

## Consequences

An old-but-accurate catalog passes check. The refresh-window semantics (strict: exactly 7 days is still fresh) are pinned by tests in `tests/pipeline.test.ts` under "rebuild gate".
