# src/catalog/

## Responsibility
Core domain layer for the two published artifacts (`catalog.json`, `pricing.json`). It defines the canonical zod schemas (models.dev-shaped provider document plus the `x_ollama` extension), builds and validates both documents from upstream sources and previous state, decides when a rebuild is warranted, extracts and resolves rate-card data into per-model costs, and publishes atomically. The artifacts are the API; nothing here runs at read time.

## Design
- **Schema as single source of truth** (`schema.ts`): zod schemas rendered to `schemas/*.schema.json` by `scripts/gen-schemas.ts`; `RateCardExtractionSchema` doubles as the LLM structured-output contract. Exports `CostSchema`, `LimitSchema`, `ModalitiesSchema`, `OllamaMetaSchema` (with `peak_cost`, `reasoning_options`), `ModelSchema`, `ProviderSchema`, `CatalogDocSchema`, `PricingDocSchema`, `RateCardExtractionSchema` + inferred types.
- **Pure decision functions** (testable, no I/O): `decideRebuild(previous, liveHash, now, force): RebuildDecision` in `gate.ts` (reason precedence force > stale > hash-changed, `STALE_AFTER_MS` = 7 days, strict staleness); `refreshDecision(previousPricing, catalog, costById, peakCostById, peak?): RefreshDecision` in `assemble.ts` returns the discriminated unions `{ skip } | { repair } | { publish }`; rate signatures come from `stableStringify`, excluding volatile fields.
- **Builders/merge-back** (`assemble.ts`): `buildCatalogDoc(sources: CatalogSources)`, `buildPricingDoc(costById, peak?)`, `applyCosts(catalog, costById, peakCostById)` refreshes cost fields in place (cost map only refreshes; peak map is authoritative). The reasoning seed from models.dev wins over the prior artifact; absent everywhere → field omitted.
- **LLM extraction** (`extract-rates.ts`): `buildRatePrompt(standard, peak)` embeds DOM row-count anchors in the prompt; `extractRates(standard, peak, call = extractJson)` validates row counts against `PricingTable.rowCount` and throws on mismatch.
- **Resolution** (`resolve-rates.ts`): `resolveRateId(rateName, catalogIds)` matches the exact id first, then the unique `familyOf` match; an ambiguous family throws. `resolveRates(rates, models, requireAll = true): RateResolution` collects problems instead of dropping silently.

## Flow
1. `update-catalog.ts` hashes the model list, calls `decideRebuild` (skip → exit).
2. Rebuild path: spec sweep via `src/sources/`, then `buildCatalogDoc` merges specs + `previousCosts`/`previousPeakCosts`/`previousReasoningOptions` (merge-back) + `reasoningSeed`, `CatalogDocSchema.parse`, `publishCatalog` → `writeAtomic` (temp file + rename).
3. `update-pricing.ts` scrapes the pricing page into `PricingTable`s, calls `extractRates` (one LLM call, JSON Schema `format`), then `resolveRates` (`requireAll` for the standard table; any problem aborts before writes).
4. `refreshDecision` compares rate signatures: identical → `applyCosts` repair of a lagging catalog or skip; changed → publish both docs via `publishCatalog`/`publishPricing`.
5. Loaders `loadCatalog`/`loadPreviousPricing` re-parse previous artifacts; a corrupt pricing doc aborts (no silent re-publication).

## Integration
- Consumed by: `src/update-catalog.ts` (`buildCatalogDoc`, `decideRebuild`, loaders, `previousSpecs`/`previousCosts`/`previousPeakCosts`/`previousReasoningOptions`, `publishCatalog`), `src/update-pricing.ts` (`extractRates`, `resolveRates`, `refreshDecision`, `loadPreviousPricing`, publishers), `src/sources/show.ts` (`ModelSchema`), `scripts/gen-schemas.ts` (JSON Schema rendering), `tests/pipeline.test.ts` + snapshot tests.
- Depends on: `src/lib/artifacts.ts` (`stableStringify`, `writeAtomic`), `src/sources/models-dev.ts` (`seedReasoningOptions`), `src/extract/ai.ts` (`extractJson`), `src/sources/pricing-page.ts` (`PricingTable`), `src/lib/ids.ts` (`familyOf`), `zod`.
