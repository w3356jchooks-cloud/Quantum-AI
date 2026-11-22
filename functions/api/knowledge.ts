import { Env, json, requireSession, parseJsonBody } from "./_shared.js";
import { acquireWikipedia } from "../_knowledge.js";
interface Context { request: Request; env: Env; }
interface Body { query?: unknown; }
export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const denied = await requireSession(request, env); if (denied) return denied;
  const rows = await env.DB.prepare("SELECT id, title, source_url, source_name, created_at FROM knowledge ORDER BY created_at DESC LIMIT 50").all();
  return json({ knowledge: rows.results });
}
export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const denied = await requireSession(request, env); if (denied) return denied;
  let body: Body;
  try { body = await parseJsonBody<Body>(request, 2048); } catch { return json({ error: "Invalid or oversized request." }, 400); }
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 120) : "";
  if (query.length < 3) return json({ error: "Enter a topic with at least three characters." }, 400);
  const now = Math.floor(Date.now() / 1000);
  const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM knowledge_requests WHERE created_at > ?").bind(now - 60).first<{ count: number }>();
  if ((recent?.count || 0) >= 6) return json({ error: "Knowledge acquisition is limited to six searches per minute." }, 429);
  await env.DB.prepare("INSERT INTO knowledge_requests (query, created_at) VALUES (?, ?)").bind(query, now).run();
  try {
    const items = await acquireWikipedia(env, query);
    return json({ query, acquired: items.map(item => ({ id: item.id, title: item.title, source_url: item.source_url, source_name: item.source_name, created_at: item.created_at })), count: items.length });
  } catch (error) {
    console.error("Wikipedia acquisition failed:", error);
    return json({ error: (error as Error).message || "Knowledge acquisition failed." }, 502);
  }
}
