/**
 * Two fetch clients: proxied (when HTTPS_PROXY set) and direct (no proxy).
 * Use getProxiedFetch for OpenAI, OpenDota, heroes, items. Use getDirectFetch for Steam (avoids proxy 502).
 */
import "dotenv/config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let proxiedFetch: any = null;

/** Proxied fetch: uses HTTPS_PROXY when set, otherwise global fetch. For OpenAI, OpenDota, heroes, items. */
export async function getProxiedFetch(): Promise<typeof fetch> {
  if (proxiedFetch) return proxiedFetch;
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!proxy) {
    proxiedFetch = globalThis.fetch;
    return proxiedFetch;
  }
  const undici = await import("undici");
  const agent = new undici.ProxyAgent(proxy);
  proxiedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    undici.fetch(String(input), { ...init, dispatcher: agent } as Parameters<typeof undici.fetch>[1]);
  console.log("[PROXY] Proxied fetch: OpenAI, OpenDota, heroes, items use proxy");
  return proxiedFetch;
}

/** Direct fetch: always no proxy. Use for Steam API (LFG) to avoid proxy 502. */
export function getDirectFetch(): typeof fetch {
  return globalThis.fetch;
}

/** Use for OpenAI client. */
export async function getOpenAIFetch(): Promise<typeof fetch> {
  return getProxiedFetch();
}

/** Use for OpenDota, heroes, items APIs. */
export async function getAppFetch(): Promise<typeof fetch> {
  return getProxiedFetch();
}
