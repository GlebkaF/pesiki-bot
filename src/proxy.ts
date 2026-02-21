/**
 * Two fetch clients: proxied (when HTTPS_PROXY set) and direct (no proxy).
 * Use getProxiedFetch for OpenAI, OpenDota, heroes, items. Use getDirectFetch for Steam (avoids proxy 502).
 */
import "dotenv/config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let proxiedFetch: any = null;
let appFetch: typeof fetch | null = null;

function isProxyTransportError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const errorWithMessage = error as { message?: unknown; cause?: unknown };
  const message = typeof errorWithMessage.message === "string" ? errorWithMessage.message.toLowerCase() : "";

  if (
    message.includes("proxy") ||
    message.includes("http tunneling") ||
    message.includes("und_err_aborted")
  ) {
    return true;
  }

  return isProxyTransportError(errorWithMessage.cause);
}

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
  if (appFetch) return appFetch;

  const proxied = await getProxiedFetch();
  const direct = getDirectFetch();

  if (proxied === direct) {
    appFetch = direct;
    return appFetch;
  }

  appFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      return await proxied(input, init);
    } catch (error) {
      if (!isProxyTransportError(error)) {
        throw error;
      }

      console.warn("[PROXY] App request failed via proxy, retrying direct connection");
      return direct(input, init);
    }
  }) as typeof fetch;

  return appFetch;
}
