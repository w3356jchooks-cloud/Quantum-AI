import { Env, json, issueSession, safeEqual, parseJsonBody } from "../_shared.js";
interface Context { request: Request; env: Env; }
export async function onRequestPost({ request, env }: Context): Promise<Response> {
  if (!env.DB || !env.APP_ACCESS_CODE || env.APP_ACCESS_CODE.length < 20 || !env.SESSION_SECRET || env.SESSION_SECRET.length < 32) return json({ error: "Quantum authentication is not configured yet." }, 503);
  let body: { accessCode?: unknown };
  try { body = await parseJsonBody<typeof body>(request, 1024); } catch { return json({ error: "Invalid request." }, 400); }
  const code = typeof body.accessCode === "string" ? body.accessCode.slice(0, 256) : "";
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const ipHash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
  const since = Math.floor(Date.now() / 1000) - 900;
  const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM auth_attempts WHERE ip_hash = ? AND created_at > ?").bind(ipHash, since).first<{ count: number }>();
  if ((recent?.count || 0) >= 10) return json({ error: "Too many attempts. Wait 15 minutes and try again." }, 429);
  if (!safeEqual(code, env.APP_ACCESS_CODE)) {
    await env.DB.prepare("INSERT INTO auth_attempts (ip_hash, created_at) VALUES (?, ?)").bind(ipHash, Math.floor(Date.now() / 1000)).run();
    return json({ error: "That access code is not correct." }, 401);
  }
  await env.DB.prepare("DELETE FROM auth_attempts WHERE created_at < ?").bind(since).run();
  return json({ token: await issueSession(env.SESSION_SECRET), expiresIn: 604800 });
}
