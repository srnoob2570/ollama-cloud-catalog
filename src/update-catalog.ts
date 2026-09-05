// update-catalog: the hash-gated pipeline.
//   check  — exit 0 when the /v1/models hash matches the published artifact
//   update — rebuild specs (only when the hash changed, the artifact is stale
//            past a week, or --force), preserving cost from the old artifact
import { fetchModelsList } from "./sources/models-api.ts";
import { fetchAllSpecs } from "./sources/show.ts";
import { fetchReasoningSeed, seedReasoningOptions } from "./sources/models-dev.ts";
import { buildCatalogDoc, CATALOG_PATH, loadCatalog, previousCosts, previousPeakCosts, previousSpecs, publishCatalog } from "./catalog/assemble.ts";
import { modelsHash } from "./lib/artifacts.ts";

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const force = process.argv.includes("--force");
const mode = process.argv[2];
if (mode !== "check" && mode !== "update") {
  console.error("usage: bun src/update-catalog.ts <check|update> [--force]");
  process.exit(2);
}

const previous = await loadCatalog();
const live = await fetchModelsList("https://ollama.com/v1");
const liveHash = modelsHash(live);

if (mode === "check") {
  console.log(
    previous?.x_ollama.models_hash === liveHash
      ? "catalog is up to date"
      : "catalog is outdated",
  );
  process.exit(previous?.x_ollama.models_hash === liveHash ? 0 : 1);
}

const stale =
  !previous ||
  Date.now() - new Date(previous.x_ollama.generated_at).getTime() > STALE_AFTER_MS;
if (!previous)
  console.log("no previous catalog; building from scratch");
else if (previous.x_ollama.models_hash === liveHash && !force && !stale) {
  console.log("model list unchanged and artifact fresh; nothing to do");
  process.exit(0);
} else
  console.log(
    force ? "--force: rebuilding specs" : previous.x_ollama.models_hash === liveHash ? `artifact stale past refresh window; refreshing` : "model list changed; rebuilding",
  );

const listedIds = live.map((m) => m.id);
if (listedIds.length !== new Set(listedIds).size)
  throw new Error("/v1/models returned duplicate ids");
if (listedIds.length === 0) throw new Error("/v1/models returned no models");

const reasoningSeed = await fetchReasoningSeed();

const prior = previousSpecs(previous);
const specs = (await fetchAllSpecs(listedIds, prior)).map((spec) => {
  // Effort tiers come from the models.dev seed (build-time only), falling
  // back to the previous artifact; absent everywhere → the field is omitted.
  const reasoningOptions =
    (reasoningSeed ? seedReasoningOptions(reasoningSeed, spec.id) : undefined) ??
    prior.get(spec.id)?.x_ollama.reasoning_options;
  return reasoningOptions
    ? { ...spec, x_ollama: { ...spec.x_ollama, reasoning_options: reasoningOptions } }
    : spec;
});
const doc = buildCatalogDoc({
  modelsHash: liveHash,
  specs,
  costs: previousCosts(previous),
  peakCosts: previousPeakCosts(previous),
});
await publishCatalog(doc);

const withoutCost = specs.filter((s) => !s.cost).map((s) => s.id);
if (withoutCost.length > 0)
  console.warn(
    `! models without cost (run update-pricing): ${withoutCost.join(", ")}`,
  );
console.log(`published ${CATALOG_PATH}: ${specs.length} models`);