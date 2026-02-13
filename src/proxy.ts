/**
 * Proxy fetch for OpenAI only (blocked in some regions).
 * OpenDota, Steam etc. use normal fetch (no proxy).
 * Set HTTPS_PROXY in .env.
 */
import "dotenv/config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let proxyFetch: any = null;

async function getProxyFetch(): Promise<typeof fetch> {
  if (proxyFetch) return proxyFetch;
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!proxy) {
    proxyFetch = globalThis.fetch;
    return proxyFetch;
  }
  const undici = await import("undici");
  const agent = new undici.ProxyAgent(proxy);
  proxyFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    undici.fetch(String(input), { ...init, dispatcher: agent } as Parameters<typeof undici.fetch>[1]);
  console.log("[PROXY] OpenAI requests will use proxy");
  return proxyFetch;
}

/** Use for OpenAI client only. Other APIs use normal fetch. */
export async function getOpenAIFetch(): Promise<typeof fetch> {
  return getProxyFetch();
}
