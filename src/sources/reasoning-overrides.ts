// Local corrections for models models.dev does not index (or indexes without
// effort tiers). Deliberate: an entry wins over the models.dev seed and the
// previous artifact; each one cites its vendor-docs source for later review.
export const REASONING_OVERRIDES = new Map<string, string[]>([
    // Native think levels per https://api-docs.deepseek.com/guides/thinking_mode
    // (requested minimal/low→low, medium/high/xhigh→high, max/ultra→max).
    ["deepseek-v4.1-flash", ["low", "high", "max"]],
]);
