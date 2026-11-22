import { Env, json, requireSession } from "../../_shared.js";
interface Context { request: Request; env: Env; params: { id: string }; }
export async function onRequestGet({ request, env, params }: Context): Promise<Response> {
  const denied = await requireSession(request, env); if (denied) return denied;
  const task = await env.DB.prepare("SELECT id, status, answer, error, created_at, updated_at FROM tasks WHERE id = ?").bind(params.id).first<{ id: string; status: string; answer: string | null; error: string | null; created_at: number; updated_at: number }>();
  if (!task) return json({ error: "Task not found." }, 404);
  return json(task);
}
