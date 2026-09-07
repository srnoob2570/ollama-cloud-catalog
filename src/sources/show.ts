import { fetchJson, fetchResponse, mapWithConcurrency, type FetchImpl } from "../lib/http.ts";
import { CHAT_URL, AuthError, ollamaAuthHeader } from "../lib/ollama.ts";
import { displayName } from "../lib/ids.ts";
import { ModelSchema, type Model } from "../catalog/schema.ts";

// https://ollama.com/api/show is the machine endpoint behind `ollama show`.
// No auth, tagged ids included, unknown ids 404. Live response (trimmed):
//   { capabilities: [...], details: { family, quantization_level },
//     model_info: { "<arch>.context_length", "general.parameter_count" },
//     modified_at: "..." }
type ShowResponse = {
  capabilities?: string[];
  details?: { family?: string; quantization_level?: string };
  model_info?: Record<string, unknown>;
  modified_at?: string;
};

export const SHOW_URL = "https://ollama.com/api/show";

// The output cap is not in /api/show, but the chat endpoint leaks it: sending
// a num_predict larger than the cap fails validation with
//   {"error":"max_tokens (...) exceeds model's maximum output tokens (N)
//    for model <id> (ref: ...)"}
// The request is rejected before any generation, so the probe costs no
// tokens. Verified live 2026-09-05 across the fleet (limits range from 65536
// to 1048576, so a hardcoded default would have been wrong for most models).
const PROBE_NUM_PREDICT = 999_999_999_999_999_999;
const MAX_OUTPUT_RE = /model's maximum output tokens \((\d+)\)/;

export async function probeMaxOutput(
  id: string,
  impl: FetchImpl = fetch,
): Promise<number> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = ollamaAuthHeader();
  if (auth) headers.authorization = auth;
  const { status, text } = await fetchResponse(
    CHAT_URL,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: id,
        messages: [{ role: "user", content: "hi" }],
        think: false,
        stream: false,
        options: { num_predict: PROBE_NUM_PREDICT },
      }),
    },
    impl,
  );
  let error = text;
  try {
    error = (JSON.parse(text) as { error?: string }).error ?? text;
  } catch {
    // keep raw text
  }
  const ok = status >= 200 && status < 300;
  if (ok)
    throw new Error(`output-limit probe for ${id} unexpectedly succeeded`);
  if (status === 401)
    throw new AuthError(`output-limit probe for ${id} needs OLLAMA_API_KEY (HTTP 401)`);
  const match = MAX_OUTPUT_RE.exec(error);
  if (!match)
    throw new Error(`output-limit probe for ${id}: unrecognized error: ${error.slice(0, 200)}`);
  const output = Number(match[1]);
  if (!Number.isInteger(output) || output <= 0)
    throw new Error(`output-limit probe for ${id}: invalid cap ${output}`);
  return output;
}

// model_info keys are architecture-prefixed ("qwen3.context_length"), so the
// context length is found by suffix, never by exact key.
const contextLengthOf = (info: ShowResponse["model_info"]): number => {
  if (!info) throw new Error("model_info missing");
  for (const [key, value] of Object.entries(info))
    if (key.endsWith(".context_length") && typeof value === "number")
      return value;
  throw new Error("model_info has no *.context_length");
};

const parameterCountOf = (info: ShowResponse["model_info"]): number | undefined => {
  if (!info) return undefined;
  for (const [key, value] of Object.entries(info))
    if (key === "general.parameter_count" && typeof value === "number" && value > 0)
      return value;
  return undefined;
};

const capability = (caps: string[] | undefined, name: string) =>
  caps?.includes(name) ?? false;

export async function fetchModelSpec(id: string, impl: FetchImpl = fetch): Promise<Model> {
  const show = await fetchJson<ShowResponse>(
    SHOW_URL,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: id }),
    },
    impl,
  );
  if (!show.modified_at) throw new Error("modified_at missing");

  const vision = capability(show.capabilities, "vision");
  const model: Model = {
    id,
    name: displayName(id),
    attachment: vision,
    reasoning: capability(show.capabilities, "thinking"),
    tool_call: capability(show.capabilities, "tools"),
    limit: {
      context: contextLengthOf(show.model_info),
      output: await probeMaxOutput(id, impl),
    },
    modalities: {
      input: vision ? ["text", "image"] : ["text"],
      output: ["text"],
    },
    release_date: show.modified_at.slice(0, 10),
    x_ollama: {
      // An empty quantization_level/family (observed on minimax-m2.7) means
      // Ollama declares nothing. The canonical value is "unknown", never
      // an invented guess.
      quantization: show.details?.quantization_level || "unknown",
      ollama_family: show.details?.family || "unknown",
      ...(parameterCountOf(show.model_info) !== undefined
        ? { parameter_count: parameterCountOf(show.model_info) }
        : {}),
    },
  };
  return ModelSchema.parse(model);
}

// Concurrent sweep with per-model fallback: a failed /api/show or output
// probe degrades to the previous catalog entry for that id; if there is
// none, the run aborts. Never ship a catalog with a model we know nothing
// about. Auth failures are systemic, not per-model: a 401 aborts the whole
// sweep instead of silently republishing stale specs.
export async function fetchAllSpecs(
  ids: string[],
  previous: Map<string, Model>,
  concurrency = 5,
  impl: FetchImpl = fetch,
): Promise<Model[]> {
  return mapWithConcurrency(ids, concurrency, async (id) => {
    try {
      return await fetchModelSpec(id, impl);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      const prior = previous.get(id);
      if (!prior)
        throw new Error(`spec fetch failed for ${id} and no previous spec exists to fall back on`, { cause: err });
      console.warn(`! spec fetch failed for ${id}; falling back to previous catalog entry`);
      return prior;
    }
  });
}