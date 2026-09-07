# ADR 0003: the extraction LLM gets no retries

Accepted 2026-09-05

## Context

`extractJson` sends markdown tables to glm-5.3-flash in JSON mode and validates the reply against a zod schema. An LLM that returns malformed JSON or missing rows could be retried until it passes, trading tokens and flakiness for a higher success rate.

## Decision

No silent retries. A reply that fails `JSON.parse` or the zod schema aborts the run. Rationale: the prompt is anchored to DOM row counts that already constrain the model, the model runs at temperature 0, and a coverage problem (a missing rate row) is exactly the kind of thing that should stop the pipeline instead of being smoothed over. The retry-free rule keeps the contract honest. If the model cannot honor it, we find out loudly.

## Consequences

Transient provider hiccups fail the scheduled run; the next cron run retries as a whole (not per request). If retries ever get added, they must be visible in the logs and bounded, not hidden inside the client.