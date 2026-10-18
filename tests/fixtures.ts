// Fixtures captured from live sources (2026-09-05): a /api/show body and the
// cheerio-cleaned pricing section. Tests run the pipeline against these,
// with no network.
export const SHOW_GLM53 = {
    capabilities: ["completion", "tools", "thinking", "vision"],
    details: { family: "glm", quantization_level: "FP8" },
    model_info: {
        "glm5.context_length": 202000,
        "general.parameter_count": 358000000000,
    },
    modified_at: "2026-08-27T10:15:30.123456Z",
};

// Captured from a live probe (2026-09-05): the chat endpoint rejects an
// oversized num_predict with the model's real output cap.
export const PROBE_GLM53_ERROR = {
    error: "max_tokens (999999999999999999) exceeds model's maximum output tokens (1048576) for model glm-5.3 (ref: 7b387ec0-dcd8-43ca-972d-c177b1214d65)",
};

// Captured from live sources (2026-10-16): clef:27b is a "decision" model —
// /api/show serves it (trimmed; capabilities carry a new "decision" marker
// and no tools/thinking), but /api/chat refuses it outright.
export const SHOW_CLEF27B = {
    capabilities: ["decision", "vision"],
    details: { family: "qwen35", quantization_level: "BF16" },
    model_info: {
        "qwen35.context_length": 65536,
        "general.parameter_count": 27356728560,
    },
    modified_at: "2026-10-04T09:00:00-07:00",
};

// The refusal, verbatim from the 2026-10-16 pipeline log: a decision model
// only serves /v1/systemone, so the oversized-num_predict probe never
// reaches output-cap validation. No cap exists to extract.
export const PROBE_CLEF27B_ERROR = {
    error: "clef:27b is a decision model and only supports /v1/systemone (ref: ce4860f6-c496-4114-8444-771391aeeef2)",
};

// Captured from ollama.com/pricing (2026-10-16): the rate card the pipeline's
// zod contract rejected (rates[0].output null). 22 rows in DOM order: clef's
// input-only row (output '-', cached '-'), the two inline "(Off-Peak)" rows
// that replaced the old peak table (deepseek pair at half price, no window
// text anywhere on the page), and '-' cached cells on mistral-large-3 and
// nemotron-3-nano.
export const RATES_LIVE_2026_10_16 = [
    { model: "clef", input: 0.24, cached_input: null, output: null },
    { model: "deepseek-v4.1-flash", input: 0.3, cached_input: 0.006, output: 1.2 },
    { model: "deepseek-v4.1-flash (Off-Peak)", input: 0.15, cached_input: 0.003, output: 0.6 },
    { model: "deepseek-v4-pro", input: 1.32, cached_input: 0.044, output: 3.96 },
    { model: "deepseek-v4-pro (Off-Peak)", input: 0.66, cached_input: 0.022, output: 1.98 },
    { model: "gemma4", input: 0.14, cached_input: 0.05, output: 0.4 },
    { model: "glm-5.3", input: 1.4, cached_input: 0.26, output: 4.4 },
    { model: "glm-5.3-flash", input: 0.15, cached_input: 0.03, output: 0.5 },
    { model: "glm-5.2", input: 1.4, cached_input: 0.26, output: 4.4 },
    { model: "gpt-oss:120b", input: 0.15, cached_input: 0.014, output: 0.6 },
    { model: "gpt-oss:20b", input: 0.07, cached_input: 0.035, output: 0.3 },
    { model: "kimi-k3", input: 3.0, cached_input: 0.3, output: 15.0 },
    { model: "kimi-k2.7-code", input: 0.95, cached_input: 0.19, output: 4.0 },
    { model: "kimi-k2.6", input: 0.95, cached_input: 0.16, output: 4.0 },
    { model: "minimax-m3", input: 0.6, cached_input: 0.12, output: 2.4 },
    { model: "minimax-m2.7", input: 0.3, cached_input: 0.06, output: 1.2 },
    { model: "mistral-large-4", input: 0.68, cached_input: 0.07, output: 2.09 },
    { model: "mistral-large-3", input: 0.5, cached_input: null, output: 1.5 },
    { model: "muse-spark-open", input: 1.25, cached_input: 0.15, output: 4.25 },
    { model: "nemotron-3-nano", input: 0.06, cached_input: null, output: 0.24 },
    { model: "nemotron-3-super", input: 0.015, cached_input: 0.015, output: 0.6 },
    { model: "nemotron-3-ultra", input: 0.1, cached_input: 0.1, output: 3.0 },
];

// The live /v1/models ids (2026-10-16): 21 cataloged models; beam is served
// but deliberately unpriced — free promo, ollama.com/blog/reflection-beam.
export const LIVE_MODEL_IDS_2026_10_16 = [
    "beam",
    "clef:27b",
    "deepseek-v4-pro:0813",
    "deepseek-v4.1-flash",
    "gemma4:31b",
    "glm-5.2",
    "glm-5.3",
    "glm-5.3-flash",
    "gpt-oss:120b",
    "gpt-oss:20b",
    "kimi-k2.6",
    "kimi-k2.7-code",
    "kimi-k3",
    "minimax-m2.7",
    "minimax-m3",
    "mistral-large-3:675b",
    "mistral-large-4",
    "muse-spark-open",
    "nemotron-3-nano:30b",
    "nemotron-3-super",
    "nemotron-3-ultra",
];

// Minimal but realistic pricing section: ids come from /library/ links.
export const PRICING_SECTION = `<section id="model-pricing">
  <h2>Model pricing</h2>
  <p>Prices are per million tokens</p>
  <table><tbody>
    <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
    <tr><td><a href="/library/deepseek-v4-flash">deepseek-v4-flash</a></td><td>$0.22</td><td>$0.007</td><td>$0.66</td></tr>
    <tr><td><a href="/library/deepseek-v4-pro">deepseek-v4-pro</a></td><td>$0.66</td><td>$0.022</td><td>$1.98</td></tr>
    <tr><td><a href="/library/gemma4">gemma4</a></td><td>$0.14</td><td>$0.05</td><td>$0.40</td></tr>
    <tr><td><a href="/library/glm-5.3">glm-5.3</a></td><td>$1.40</td><td>$0.26</td><td>$4.40</td></tr>
    <tr><td><a href="/library/glm-5.3-flash">glm-5.3-flash</a></td><td>$0.15</td><td>$0.03</td><td>$0.50</td></tr>
  </tbody></table>
</section>`;

// Same section with the peak-pricing table the page grew on 2026-09: a
// subset of models (the deepseek pair) at 2x rates, 12:00-18:00 UTC Mon-Fri.
export const PRICING_SECTION_PEAK = `<section id="model-pricing">
  <h2>Model pricing</h2>
  <p>Prices are per million tokens</p>
  <table><tbody>
    <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
    <tr><td><a href="/library/deepseek-v4-flash">deepseek-v4-flash</a></td><td>$0.22</td><td>$0.007</td><td>$0.66</td></tr>
    <tr><td><a href="/library/deepseek-v4-pro">deepseek-v4-pro</a></td><td>$0.66</td><td>$0.022</td><td>$1.98</td></tr>
    <tr><td><a href="/library/gemma4">gemma4</a></td><td>$0.14</td><td>$0.05</td><td>$0.40</td></tr>
    <tr><td><a href="/library/glm-5.3">glm-5.3</a></td><td>$1.40</td><td>$0.26</td><td>$4.40</td></tr>
    <tr><td><a href="/library/glm-5.3-flash">glm-5.3-flash</a></td><td>$0.15</td><td>$0.03</td><td>$0.50</td></tr>
  </tbody></table>
  <h3>Peak pricing</h3>
  <p>Peak pricing applies between 12:00 and 18:00 UTC, Monday to Friday.</p>
  <table><tbody>
    <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
    <tr><td><a href="/library/deepseek-v4-flash">deepseek-v4-flash</a></td><td>$0.44</td><td>$0.014</td><td>$1.32</td></tr>
    <tr><td><a href="/library/deepseek-v4-pro">deepseek-v4-pro</a></td><td>$1.32</td><td>$0.044</td><td>$3.96</td></tr>
  </tbody></table>
</section>`;

// The intro paragraph of the live section (2026-10-16), verbatim. The
// 2026-10-16T23:47 pipeline run claimed this text was missing — it was a
// probe bug: the paragraph has a class attribute a bare `<p>` regex missed.
export const OFF_PEAK_WINDOW_LIVE =
    "Off-peak pricing apply outside 12:00 and 18:00 UTC on weekdays and all day on weekends.";

// The live section shape (2026-10-16, trimmed to the load-bearing rows): an
// intro paragraph carrying the off-peak window, one rate table, and inline
// "Model (Off-Peak)" mirror rows with the same library-link markup.
export const PRICING_SECTION_OFFPEAK = `<section id="model-pricing">
  <h2>Model pricing</h2>
  <p class="text-sm text-neutral-500 mb-6">Pay as you go with usage credits. Prices are per million tokens. Off-peak pricing apply outside 12:00 and 18:00 UTC on weekdays and all day on weekends.</p>
  <table><tbody>
    <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
    <tr><td><a href="/library/clef">clef</a></td><td>$0.24</td><td>-</td><td>-</td></tr>
    <tr><td><a href="/library/deepseek-v4.1-flash">deepseek-v4.1-flash</a></td><td>$0.30</td><td>$0.006</td><td>$1.20</td></tr>
    <tr><td><a href="/library/deepseek-v4.1-flash">deepseek-v4.1-flash (Off-Peak)</a></td><td>$0.15</td><td>$0.003</td><td>$0.60</td></tr>
    <tr><td><a href="/library/deepseek-v4-pro">deepseek-v4-pro</a></td><td>$1.32</td><td>$0.044</td><td>$3.96</td></tr>
    <tr><td><a href="/library/deepseek-v4-pro">deepseek-v4-pro (Off-Peak)</a></td><td>$0.66</td><td>$0.022</td><td>$1.98</td></tr>
    <tr><td><a href="/library/glm-5.3">glm-5.3</a></td><td>$1.40</td><td>$0.26</td><td>$4.40</td></tr>
  </tbody></table>
</section>`;

// The tag index of /library/deepseek-v4.1-flash/tags (2026-10-17): the "View
// all" of the ficha's Models section. Both cloud variants, each with two
// anchors (mobile + desktop share the href) — deduped by href, not text.
export const TAGS_SECTION_FLASH = `<html><body>
  <a href="/library/deepseek-v4.1-flash">deepseek-v4.1-flash</a>
  <a href="/library/deepseek-v4.1-flash/tags">View all</a>
  <a href="/library/deepseek-v4.1-flash:cloud">deepseek-v4.1-flash:cloud</a>
  <a href="/library/deepseek-v4.1-flash:cloud">deepseek-v4.1-flash:cloud</a>
  <a href="/library/deepseek-v4.1-flash:1017-cloud">deepseek-v4.1-flash:1017-cloud</a>
  <a href="/library/deepseek-v4.1-flash:1017-cloud">deepseek-v4.1-flash:1017-cloud</a>
</body></html>`;

// The gemma4 tag index (2026-10-17, trimmed to the load-bearing rows): local
// variants mixed with the cloud ones — the catalog id gemma4:31b must resolve
// to its cloud page (31b-cloud), never the identically-tagged local 31b.
export const TAGS_SECTION_GEMMA4 = `<html><body>
  <a href="/library/gemma4">gemma4</a>
  <a href="/library/gemma4:latest">gemma4:latest</a>
  <a href="/library/gemma4:e2b">gemma4:e2b</a>
  <a href="/library/gemma4:31b">gemma4:31b</a>
  <a href="/library/gemma4:31b-cloud">gemma4:31b-cloud</a>
  <a href="/library/gemma4:cloud">gemma4:cloud</a>
  <a href="/library/gemma4:31b-mlx">gemma4:31b-mlx</a>
</body></html>`;

// The cost block of /library/deepseek-v4.1-flash:1017-cloud (2026-10-17):
// Peak/Off-Peak tabs and three labeled cells. data-rate="base" is the listed
// standard (Peak) rate, data-rate="peak" the Off-Peak column — the page's tab
// naming. The tab buttons carry data-rate too; only div.pricing-rate cells are
// data.
export const MODEL_PAGE_FLASH1017 = `<html><body><div class="pricing-block">
  <span>Cost</span><span>/1M tokens</span>
  <div role="tablist" aria-label="Price type">
    <button type="button" role="tab" data-rate="base" class="pricing-rate-tab">Peak</button>
    <button type="button" role="tab" data-rate="peak" class="pricing-rate-tab">Off-Peak</button>
  </div>
  <div>
    <div class="flex min-w-0 flex-col gap-1 text-left">
      <div data-rate="base" class="pricing-rate">$0.30</div>
      <div data-rate="peak" class="pricing-rate hidden">$0.15</div>
      <div class="truncate">input</div>
    </div>
    <div class="flex min-w-0 flex-col gap-1 text-left">
      <div data-rate="base" class="pricing-rate">$0.006</div>
      <div data-rate="peak" class="pricing-rate hidden">$0.003</div>
      <div class="truncate">cached</div>
    </div>
    <div class="flex min-w-0 flex-col gap-1 text-left">
      <div data-rate="base" class="pricing-rate">$1.20</div>
      <div data-rate="peak" class="pricing-rate hidden">$0.60</div>
      <div class="truncate">output</div>
    </div>
  </div>
</div></body></html>`;

// /library/clef:27b-cloud (2026-10-17): a decision model's page prices input
// only — no tabs, no output cell, because a System One model's output is free.
export const MODEL_PAGE_CLEF27B = `<html><body><div class="pricing-block">
  <span>Cost</span><span>/1M tokens</span>
  <div>
    <div class="flex min-w-0 flex-col gap-1 text-left">
      <div data-rate="base" class="pricing-rate">$0.24</div>
      <div class="truncate">input</div>
    </div>
  </div>
</div></body></html>`;

// /library/beam:cloud (2026-10-17): the free promo's page has no cost block.
// The switchPricingRate script present on every page names .pricing-rate in
// its code; the extractor must see no cells in it.
export const MODEL_PAGE_BEAM_NO_COST = `<html><body><div class="pricing-block">
  <span>Context</span><span>1M tokens</span>
</div>
<script>
  block.querySelectorAll('.pricing-rate[data-rate]').forEach(el => el.classList.toggle('hidden', el.dataset.rate !== rate));
</script>
</body></html>`;

export const MODELS_LIST = {
    object: "list",
    data: [
        { id: "glm-5.3", created: 1756292130, object: "model", owned_by: "ollama" },
        { id: "glm-5.3-flash", created: 1756292200, object: "model", owned_by: "ollama" },
    ],
};
