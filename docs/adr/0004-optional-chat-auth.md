# ADR 0004: chat-API auth is optional in lib/ollama.ts

Accepted 2026-09-05

## Context

Two callers hit `POST /api/chat`: the output-limit probe in `src/sources/show.ts` and the extraction client in `src/extract/ai.ts`. Both need the chat URL and a Bearer header, but their auth requirements are opposite: the probe treats an unset `OLLAMA_API_KEY` as expected (it reads the 401 and names the variable), while extraction needs the key to exist and throws when it does not.

## Decision

`src/lib/ollama.ts` exports `CHAT_URL` and `ollamaAuthHeader()` returning `string | undefined`. It decides nothing about missing keys. Each caller applies its own policy: extraction throws, the probe proceeds without the header. The auth header is not folded into `lib/http.ts` because three of the four transport callers (models API, models.dev, pricing page) are unauthenticated endpoints.

## Consequences

One place to change if Ollama moves the chat endpoint or changes the auth scheme. The probe's "needs OLLAMA_API_KEY (HTTP 401)" message stays testable as data rather than as a thrown-by-default path.
