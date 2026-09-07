# src/lib/

## Responsibility

Shared, dependency-free plumbing: HTTP transport (fail-loud, test-seamed), Ollama chat endpoint constants and optional auth, artifact identity/serialization/atomic write, and model-id parsing/naming.

## Design

- **Test seam via injectable fetch:** every fetcher takes `impl: FetchImpl = fetch` (`FetchImpl = typeof fetch`); production passes the default, tests inject fakes.
- **Fail-closed layering:** low-level `fetchResponse` returns data for any HTTP status; wrappers `fetchText`/`fetchJson` enforce 2xx and throw on violation. Only transport failure (network/timeout) throws at the bottom level.
- Exported functions:
  - `fetchResponse(url: string, init?: RequestInit, impl?: FetchImpl): Promise<{status: number; text: string}>` returns non-2xx as data, not failure (the output-limit probe reads a 400 body). It sets a 30s `AbortSignal.timeout` and injects `user-agent: ollama-cloud-catalog`.
  - `fetchText(url, init?, impl?): Promise<string>` throws on non-2xx.
  - `fetchJson<T>(url, init?, impl?): Promise<T>` is `fetchText` + `JSON.parse`, and throws with cause on invalid JSON.
  - `mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]>` is a shared-cursor, order-preserving worker pool; it bounds the `/api/show` sweep.
  - `CHAT_URL: string` (`https://ollama.com/api/chat`), `ollamaAuthHeader(): string | undefined` yields `Bearer $OLLAMA_API_KEY` or `undefined`; auth optionality is a caller decision (spec sweep tolerates absence, extraction requires it).
  - `modelsHash(models: {id: string; created: number}[]): string` is SHA-256 over sorted `id:created` pairs joined by `|`.
  - `stableStringify(value: unknown): string` produces recursive key-sorted JSON, 2-space indent, trailing newline (stable diffs).
  - `writeAtomic(path: string, contents: string): Promise<void>` writes `<path>.tmp` via `Bun.write`, then renames it over the target.
  - `familyOf(id: string): string`, `tagOf(id: string): string`, `displayName(id: string): string` split on `:`; titleCase uses the `KNOWN_ACRONYMS` set (`gpt`, `oss`, `glm`, `llm`) uppercased, tag uppercased.

## Flow

Callers (`src/sources/*`) pass a fetch impl through; `fetchJson`/`fetchText` delegate to `fetchResponse` and either return parsed data or throw. Publish path: builders produce document trees → `stableStringify` → `writeAtomic` temp+rename. `modelsHash` output feeds the rebuild gate in `src/update-catalog.ts`. `ids.ts` is pure string transforms used at build time for display names and family resolution.

## Integration

- Consumed by: `src/sources/models-api.ts` and `models-dev.ts` (`fetchJson`), `pricing-page.ts` (`fetchText`), `show.ts` (`fetchJson`, `fetchResponse`, `mapWithConcurrency`, `CHAT_URL`, `ollamaAuthHeader`, `displayName`), `src/catalog/assemble.ts` (`stableStringify`, `writeAtomic`), `src/catalog/resolve-rates.ts` (`familyOf`), `src/update-catalog.ts` (`modelsHash`), `src/extract/ai.ts` (`FetchImpl` type).
- Depends on: `node:crypto`, `node:fs/promises`, `Bun.write`, global `fetch`. No intra-repo imports.