import { Env, json, requireInternal } from "../../../_shared.js";
interface Context { request: Request; env: Env; params: { id: string }; }
export async function onRequestGet({ request, env, params }: Context): Promise<Response> {
  const denied = requireInternal(request, env); if (denied) return denied;
  const task = await env.DB.prepare("SELECT id, status, messages_json FROM tasks WHERE id = ?").bind(params.id).first<{ id: string; status: string; messages_json: string }>();
  if (!task) return json({ error: "Task not found." }, 404);
  if (task.status === "queued") await env.DB.prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'").bind(Math.floor(Date.now() / 1000), params.id).run();
  return json({ id: task.id, messages: JSON.parse(task.messages_json) });
}
