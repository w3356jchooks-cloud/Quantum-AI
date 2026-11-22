import { Env, json } from "../_shared";
interface Context { env: Env; }
export async function onRequestGet({ env }: Context): Promise<Response> {
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return json({ status: "ok", database: "connected", model: "SmolLM2-135M-Instruct", inference: "GitHub Actions CPU runner", githubConfigured: !!(env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY), timestamp: new Date().toISOString() });
  } catch {
    return json({ status: "degraded", database: "unavailable", model: "SmolLM2-135M-Instruct", inference: "GitHub Actions CPU runner" }, 503);
  }
}
