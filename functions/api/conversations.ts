import { Env, json, requireSession } from "../_shared.js";
interface Context { request: Request; env: Env; }
export async function onRequestGet({ request, env }: Context): Promise<Response> {
  const denied = await requireSession(request, env); if (denied) return denied;
  const rows = await env.DB.prepare("SELECT id, title, updated_at FROM conversations ORDER BY updated_at DESC LIMIT 50").all<{ id: string; title: string; updated_at: number }>();
  return json({ conversations: rows.results });
}
