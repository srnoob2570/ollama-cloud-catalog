// https://ollama.com/v1/models — the machine-readable model list that gates
// the whole pipeline. Shapes observed live:
//   { object:"list", data: [{ id, created, object:"model", owned_by }] }
import { fetchJson } from "../lib/http.ts";

type ListResponse = {
  data?: { id: string; created: number }[];
};

export type ListedModel = { id: string; created: number };

export async function fetchModelsList(baseUrl: string): Promise<ListedModel[]> {
  const body = await fetchJson<ListResponse>(`${baseUrl}/models`);
  const models = body.data;
  if (!Array.isArray(models) || models.length === 0)
    throw new Error(`${baseUrl}/models: empty or unrecognized payload`);
  for (const m of models)
    if (typeof m?.id !== "string" || typeof m?.created !== "number")
      throw new Error(`${baseUrl}/models: entry without id/created`);
  return models;
}