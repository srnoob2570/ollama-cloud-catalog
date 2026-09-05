// Shared low-level bits for the two Ollama Cloud chat-API callers. Auth is
// OPTIONAL here: callers decide whether an unset OLLAMA_API_KEY is an error
// (the spec sweep probes without it; the extraction client requires it).
export const CHAT_URL = "https://ollama.com/api/chat";

export function ollamaAuthHeader(): string | undefined {
  const apiKey = process.env.OLLAMA_API_KEY;
  return apiKey ? `Bearer ${apiKey}` : undefined;
}