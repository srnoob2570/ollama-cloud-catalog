import { createHash } from "node:crypto";
import { rename } from "node:fs/promises";

// Identity of the model list: `id:created` pairs, sorted, joined. created
// changes when Ollama touches a model, so the gate is sensitive to more than
// add/remove, matching the hash contract of the original catalog repo.
export const modelsHash = (models: { id: string; created: number }[]) =>
    createHash("sha256")
        .update(
            models
                .map((m) => `${m.id}:${m.created}`)
                .sort()
                .join("|"),
        )
        .digest("hex");

// Sorted-keys serialization so regenerations produce stable diffs.
export const stableStringify = (value: unknown) => JSON.stringify(sortKeys(value), null, 2) + "\n";

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([k, v]) => [k, sortKeys(v)]),
        );
    }
    return value;
}

// Atomic publish: write the sibling temp file, then rename over the target.
// A crashed run can never leave a half-written artifact behind.
export async function writeAtomic(path: string, contents: string) {
    const tmp = `${path}.tmp`;
    await Bun.write(tmp, contents);
    await rename(tmp, path);
}
