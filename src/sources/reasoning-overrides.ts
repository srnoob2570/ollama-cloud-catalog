// The four reasoning-effort tiers every cataloged model accepts. Confirmed
// live on 2026-09-12 against /v1/chat/completions: an invalid
// `reasoning_effort` on each of the 20 catalog ids returns the same accepted
// vocabulary (minimal, low, medium, high, xhigh, ultra, max, none), and these
// four answered 200 on a random sample plus a sweep of the rest. The wider
// values stay unpublished: they were only verified on one model, not all.
export const REASONING_OPTIONS = ["low", "medium", "high", "max"];
