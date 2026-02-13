/**
 * Proxy setup for OpenAI (blocked in some regions).
 * Must be imported first, before any fetch/HTTP calls.
 * Set HTTPS_PROXY in .env (e.g. socks5://user:pass@host:1080 or http://host:8080)
 * Optional: NO_PROXY=api.opendota.com to skip proxy for OpenDota (often works from РФ)
 */
import "dotenv/config";

if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) {
  const { setGlobalDispatcher, EnvHttpProxyAgent } = await import("undici");
  setGlobalDispatcher(new EnvHttpProxyAgent());
  console.log("[PROXY] Using proxy for outgoing requests");
}
