// Structured-output client for Ollama Cloud (extraction model:
// glm-5.3-flash). The cloud endpoint honors `format: "json"` but ignores
// json_schema formats (verified 2026-09-05 against /api/chat and /v1), so
// the schema is enforced in two layers instead: rendered into the prompt as
// guidance, and validated with zod after parsing. Anything that doesn't
// match the contract fails the run — no silent retries, no lenient parsing.
import { fetchJson } from "../lib/http.ts";
import { z } from "zod";

const CHAT_URL = "https://ollama.com/api/chat";
const EXTRACTION_MODEL = process.env.OLLAMA_EXTRACT_MODEL ?? "glm-5.3-flash";

type ChatResponse = { message?: { content?: string } };

export async function extractJson<S extends z.ZodType>(
  schema: S,
  instructions: string,
  user: string,
): Promise<z.infer<S>> {
  const apiKey = process.env.OLLAMA_API_KEY;
  if (!apiKey) throw new Error("OLLAMA_API_KEY is not set");
  const jsonSchema = JSON.stringify(
    z.toJSONSchema(schema, { target: "draft-7", io: "input" }),
  );
  const body = await fetchJson<ChatResponse>(CHAT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: EXTRACTION_MODEL,
      stream: false,
      format: "json",
      messages: [
        {
          role: "system",
          content: `${instructions}\nRespond with ONLY a JSON object matching this JSON Schema (no markdown, no fences):\n${jsonSchema}`,
        },
        { role: "user", content: user },
      ],
      options: { temperature: 0 },
    }),
  });
  const content = body.message?.content;
  if (!content) throw new Error("chat response has no message content");
  const parsed: unknown = JSON.parse(content); // format:"json" guarantees raw JSON; a SyntaxError here is a provider contract break
  return schema.parse(parsed);
}