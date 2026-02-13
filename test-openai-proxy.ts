/**
 * Test OpenAI through proxy. Run: npx tsx test-openai-proxy.ts
 */
import "dotenv/config";
import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";
import OpenAI from "openai";

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
console.log("HTTPS_PROXY:", proxy ? "set" : "NOT SET");
if (proxy) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
  console.log("[PROXY] Using proxy");
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY not set");
  process.exit(1);
}

const openai = new OpenAI({ apiKey, baseURL: process.env.OPENAI_BASE_URL });

async function test() {
  console.log("\n1. Testing OpenAI API...");
  try {
    const r = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Say hi in 3 words" }],
      max_tokens: 10,
    });
    console.log("✅ Success:", r.choices[0]?.message?.content);
  } catch (err: unknown) {
    const e = err as { message?: string; cause?: { message?: string }; status?: number };
    console.error("❌ Error:", e.message || e);
    if (e.cause) console.error("   Cause:", e.cause.message);
    if (e.status) console.error("   Status:", e.status);
  }
}

test();
