/**
 * Proxy fetch for OpenAI only (blocked in some regions).
 * OpenDota, Steam etc. use normal fetch (no proxy).
 * Set HTTPS_PROXY in .env.
 */
import "dotenv/config";

let proxyFetch: typeof fetch | null = null;

async function getProxyFetch(): Promise<typeof fetch> {
  if (proxyFetch) return proxyFetch;
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  if (!proxy) {
    proxyFetch = globalThis.fetch;
    return proxyFetch;
  }
  const { fetch: undiciFetch, ProxyAgent } = await import("undici");
  const agent = new ProxyAgent(proxy);
  proxyFetch = (url: string | URL | Request, init?: RequestInit) =>
    undiciFetch(url, { ...init, dispatcher: agent });
  console.log("[PROXY] OpenAI requests will use proxy");
  return proxyFetch;
}

/** Use for OpenAI client only. Other APIs use normal fetch. */
export async function getOpenAIFetch(): Promise<typeof fetch> {
  return getProxyFetch();
}
