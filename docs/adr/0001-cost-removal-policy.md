# ADR 0001: standard cost is never removed, the peak map is authoritative

Accepted 2026-09-05

## Context

`applyCosts` refreshes cost fields in `catalog.json` during the pricing flow. The rate card is a snapshot of what Ollama charges today, but the catalog also carries cost data preserved across rebuilds from the previous artifact. When a model disappears from the rate card, we must decide whether its stored cost is stale data or still-worth-keeping history.

## Decision

The cost map only refreshes: a model absent from it keeps its existing standard cost. The peak map is authoritative: a model absent from it loses its `x_ollama.peak_cost`, both in the publish and the repair branch. Rationale: standard rates exist for nearly every model and a scrape miss must not erase them, while peak membership is a deliberate small subset; leaving a stale `peak_cost` behind publishes a rate that no longer matches the page.

## Consequences

Rebuilds still preserve both fields via `previousCosts`/`previousPeakCosts`. A full rate-card outage on the peak table would strip all peak costs rather than freeze them; acceptable because the peak table missing entirely is the no-peak case, which is legitimate page state. Standard-cost cleanup, if ever needed, is a separate decision.