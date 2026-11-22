import { Env, json, requireSession } from "../../_shared";
interface Context { request: Request; env: Env; params: { id: string }; }
export async function onRequestGet({ request, env, params }: Context): Promise<Response> {
  const denied = await requireSession(request, env); if (denied) return denied;
  const row = await env.DB.prepare("SELECT id, title, messages_json, updated_at FROM conversations WHERE id = ?").bind(params.id).first<{ id: string; title: string; messages_json: string; updated_at: number }>();
  if (!row) return json({ error: "Conversation not found." }, 404);
  return json({ id: row.id, title: row.title, messages: JSON.parse(row.messages_json), updatedAt: row.updated_at });
}
export async function onRequestDelete({ request, env, params }: Context): Promise<Response> {
  const denied = await requireSession(request, env); if (denied) return denied;
  await env.DB.prepare("DELETE FROM tasks WHERE conversation_id = ?").bind(params.id).run();
  await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
