import { Env, json } from "../_shared";
interface Context { env: Env; }
export async function onRequestGet({ env }: Context): Promise<Response> {
  const authConfigured = !!(env.APP_ACCESS_CODE && env.APP_ACCESS_CODE.length >= 20 && env.SESSION_SECRET && env.SESSION_SECRET.length >= 32 && env.INTERNAL_API_SECRET && env.INTERNAL_API_SECRET.length >= 32);
  const githubConfigured = !!(env.GITHUB_APP_ID && env.GITHUB_INSTALLATION_ID && env.GITHUB_APP_PRIVATE_KEY);
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    const ready = authConfigured && githubConfigured;
    return json({ status: ready ? "ok" : "setup_required", database: "connected", authConfigured, githubConfigured, model: "SmolLM2-135M-Instruct", inference: "GitHub Actions CPU runner", timestamp: new Date().toISOString() });
  } catch {
    return json({ status: "degraded", database: "unavailable", authConfigured, githubConfigured, model: "SmolLM2-135M-Instruct", inference: "GitHub Actions CPU runner" }, 503);
  }
}
