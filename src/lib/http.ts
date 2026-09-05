// Fail-loud HTTP helpers. A broken fetch must abort the run, not write a
// stale artifact as if it were fresh — the runtime consumer (the plugin) is
// the fail-open side, this repo is the fail-closed side.
export type FetchImpl = typeof fetch;

// Low-level transport: returns status + body for BOTH success and expected
// HTTP errors (the output-limit probe reads a 400 body). Only transport
// failure — network error, timeout — throws. The impl parameter is the test
// seam; production always passes the default fetch.
export async function fetchResponse(
  url: string,
  init: RequestInit | undefined,
  impl: FetchImpl = fetch,
): Promise<{ status: number; text: string }> {
  const res = await impl(url, {
    ...init,
    headers: {
      "user-agent": "ollama-cloud-catalog",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(30_000),
  });
  return { status: res.status, text: await res.text() };
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
  impl: FetchImpl = fetch,
): Promise<T> {
  const res = await fetchText(url, init, impl);
  try {
    return JSON.parse(res) as T;
  } catch (err) {
    throw new Error(`${url}: response is not valid JSON`, { cause: err });
  }
}

export async function fetchText(
  url: string,
  init?: RequestInit,
  impl: FetchImpl = fetch,
): Promise<string> {
  const { status, text } = await fetchResponse(url, init, impl);
  if (!(status >= 200 && status < 300)) throw new Error(`${url} -> HTTP ${status}`);
  return text;
}

// Bounded-concurrency map: the /api/show sweep fires N workers over the id
// list instead of one request at a time, but never floods ollama.com.
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await fn(items[index]!, index);
      }
    }),
  );
  return results;
}