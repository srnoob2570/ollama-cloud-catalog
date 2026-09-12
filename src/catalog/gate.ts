// The rebuild gate: when the published catalog may be left untouched. A
// rebuild happens when there is no previous artifact, --force was given, the
// artifact is stale past the refresh window, or the model list changed.
// Decision only. The script maps reasons to logs and exit codes.
export type RebuildDecision =
    { action: "skip" } | { action: "rebuild"; reason: "no-previous" | "force" | "stale" | "hash-changed" };

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// Reason precedence matches the CLI contract: force > stale > hash-changed.
// An artifact that is stale AND sees a changed model list reports
// hash-changed, the more urgent reason, and rebuilds either way.
// Staleness is strict: an artifact exactly STALE_AFTER_MS old is still fresh.
export function decideRebuild(
    previous: { x_ollama: { models_hash: string; generated_at: string } } | undefined,
    liveHash: string,
    now: number,
    force: boolean,
): RebuildDecision {
    if (!previous) return { action: "rebuild", reason: "no-previous" };
    if (force) return { action: "rebuild", reason: "force" };
    if (previous.x_ollama.models_hash !== liveHash) return { action: "rebuild", reason: "hash-changed" };
    if (now - new Date(previous.x_ollama.generated_at).getTime() > STALE_AFTER_MS)
        return { action: "rebuild", reason: "stale" };
    return { action: "skip" };
}

export type CheckOutcome = { message: string; exitCode: 0 | 1 };

// Check mode answers one question with exit codes only (ADR 0002): is the
// published models_hash the live one? The mapping lives here so a test can
// hold it without spawning the CLI, and so the message and the codes cannot
// drift apart.
export function checkOutcome(
    previous: { x_ollama: { models_hash: string } } | undefined,
    liveHash: string,
): CheckOutcome {
    const upToDate = previous?.x_ollama.models_hash === liveHash;
    return {
        message: upToDate ? "catalog is up to date" : "catalog is outdated",
        exitCode: upToDate ? 0 : 1,
    };
}
