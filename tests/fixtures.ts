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
  error:
    "max_tokens (999999999999999999) exceeds model's maximum output tokens (1048576) for model glm-5.3 (ref: 7b387ec0-dcd8-43ca-972d-c177b1214d65)",
};

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

export const MODELS_LIST = {
  object: "list",
  data: [
    { id: "glm-5.3", created: 1756292130, object: "model", owned_by: "ollama" },
    { id: "glm-5.3-flash", created: 1756292200, object: "model", owned_by: "ollama" },
  ],
};