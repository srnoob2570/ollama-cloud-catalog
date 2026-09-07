# scripts/

## Responsibility
`gen-schemas.ts` renders the canonical zod schemas (`CatalogDocSchema`, `PricingDocSchema` from `src/catalog/schema.ts`) to `schemas/*.schema.json` for external consumers (ajv, editors, other toolchains).

## Design
- One-shot, top-level-await script with no CLI flags or arguments.
- `z.toJSONSchema(schema, { target: "draft-7", io: "input" })` is the single conversion step; `src/catalog/schema.ts` remains the single source of truth. The JSON files are derived artifacts.
- Deterministic output: 2-space indented JSON with a trailing newline, so regenerated files diff cleanly.

## Flow
1. `mkdir("schemas", { recursive: true })` creates the target directory idempotently.
2. Iterate the fixed `[["catalog", CatalogDocSchema], ["pricing", PricingDocSchema]]` pairs.
3. Convert each zod schema to a draft-7 JSON Schema (input shape) and write `schemas/catalog.schema.json` / `schemas/pricing.schema.json`, logging each written path.

## Integration
- Run manually via `npm run gen-schemas` (`bun scripts/gen-schemas.ts`); output is committed.
- CI does not regenerate: it validates published artifacts against the committed schemas via the zod parse, so schema changes require re-running this script and committing the result.
- Depends only on `zod` and `src/catalog/schema.ts`; no network, no other repo modules.