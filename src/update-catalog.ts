// update-catalog: the hash-gated pipeline.
//   check:  exit 0 when the /v1/models hash matches the published artifact
//   update: rebuild specs (only when the hash changed, the artifact is stale
//           past a week, or --force), preserving cost from the old artifact
import { fetchModelsList } from "./sources/models-api.ts";
import { fetchAllSpecs } from "./sources/show.ts";
import { fetchReasoningSeed } from "./sources/models-dev.ts";
import {
    buildCatalogDoc,
    CATALOG_PATH,
    loadCatalog,
    previousCosts,
    previousPeakCosts,
    previousReasoningOptions,
    previousSpecs,
    publishCatalog,
} from "./catalog/assemble.ts";
import { decideRebuild } from "./catalog/gate.ts";
import { modelsHash } from "./lib/artifacts.ts";

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
    console.log(previous?.x_ollama.models_hash === liveHash ? "catalog is up to date" : "catalog is outdated");
    process.exit(previous?.x_ollama.models_hash === liveHash ? 0 : 1);
}

const decision = decideRebuild(previous, liveHash, Date.now(), force);
if (decision.action === "skip") {
    console.log("model list unchanged and artifact fresh; nothing to do");
    process.exit(0);
}
console.log(
    decision.reason === "force"
        ? "--force: rebuilding specs"
        : decision.reason === "stale"
          ? "artifact stale past refresh window; refreshing"
          : decision.reason === "no-previous"
            ? "no previous catalog; building from scratch"
            : "model list changed; rebuilding",
);

const reasoningSeed = await fetchReasoningSeed();

const specs = await fetchAllSpecs(
    live.map((m) => m.id),
    previousSpecs(previous),
);
const doc = buildCatalogDoc({
    modelsHash: liveHash,
    specs,
    costs: previousCosts(previous),
    peakCosts: previousPeakCosts(previous),
    ...(reasoningSeed ? { reasoningSeed } : {}),
    reasoningPrior: previousReasoningOptions(previous),
});
await publishCatalog(doc);

const withoutCost = specs.filter((s) => !s.cost).map((s) => s.id);
if (withoutCost.length > 0) console.warn(`! models without cost (run update-pricing): ${withoutCost.join(", ")}`);
console.log(`published ${CATALOG_PATH}: ${specs.length} models`);
