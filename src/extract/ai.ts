// Structured-output client for Ollama Cloud (extraction model:
// glm-5.3-flash), built on the official `ollama` JS client. The JSON Schema
// is passed in `format` and also rendered into the prompt. The endpoint
// accepts json_schema formats (verified live 2026-09-07), and the earlier
// `format: "json"` string mode is no longer used. zod validation remains the
// backstop: anything that doesn't match the contract fails the run. No
// silent retries, no lenient parsing.
import { Ollama } from "ollama";
import type { FetchImpl } from "../lib/http.ts";
import { z } from "zod";

const EXTRACTION_MODEL = process.env.OLLAMA_EXTRACT_MODEL ?? "glm-5.3-flash";

export async function extractJson<S extends z.ZodType>(
    schema: S,
    instructions: string,
    user: string,
    impl: FetchImpl = fetch,
): Promise<z.infer<S>> {
    if (!process.env.OLLAMA_API_KEY) throw new Error("OLLAMA_API_KEY is not set");
    const client = new Ollama({ host: "https://ollama.com", fetch: impl });
    const jsonSchema = z.toJSONSchema(schema, {
        target: "draft-7",
        io: "input",
    });
    const response = await client.chat({
        model: EXTRACTION_MODEL,
        stream: false,
        format: jsonSchema,
        options: { temperature: 0 },
        messages: [
            {
                role: "system",
                content: `${instructions}\nRespond with ONLY a JSON object matching this JSON Schema (no markdown, no fences):\n${JSON.stringify(jsonSchema)}`,
            },
            { role: "user", content: user },
        ],
    });
    const content = response.message?.content;
    if (!content) throw new Error("chat response has no message content");
    const parsed: unknown = JSON.parse(content); // a SyntaxError here is a provider contract break
    return schema.parse(parsed);
}
