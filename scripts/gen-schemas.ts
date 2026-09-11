// Renders the canonical zod schemas to schemas/*.schema.json for external
// consumers (ajv, editors, other toolchains). Run locally and commit; CI
// only validates artifacts against them via the zod parse.
import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { CatalogDocSchema, PricingDocSchema } from "../src/catalog/schema.ts";

await mkdir("schemas", { recursive: true });
for (const [name, schema] of [
    ["catalog", CatalogDocSchema],
    ["pricing", PricingDocSchema],
] as const) {
    const json = z.toJSONSchema(schema, { target: "draft-7", io: "input" });
    await writeFile(`schemas/${name}.schema.json`, JSON.stringify(json, null, 2) + "\n");
    console.log(`schemas/${name}.schema.json written`);
}
