import { Env, json, requireInternal, parseJsonBody } from "../../_shared.js";
interface Context { request: Request; env: Env; }
interface Body { taskId?: string; status?: "complete" | "failed"; answer?: string; error?: string; }
export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const denied = requireInternal(request, env); if (denied) return denied;
  let body: Body; try { body = await parseJsonBody<Body>(request, 16_000); } catch { return json({ error: "Invalid or oversized JSON." }, 400); }
  if (!body.taskId || !["complete", "failed"].includes(body.status || "")) return json({ error: "taskId and a valid status are required." }, 400);
  const answer = typeof body.answer === "string" ? body.answer.slice(0, 12000) : "";
  const error = typeof body.error === "string" ? body.error.slice(0, 500) : "";
  const task = await env.DB.prepare("SELECT conversation_id, messages_json FROM tasks WHERE id = ?").bind(body.taskId).first<{ conversation_id: string; messages_json: string }>();
  if (!task) return json({ error: "Task not found." }, 404);
  const now = Math.floor(Date.now() / 1000);
  const update = await env.DB.prepare("UPDATE tasks SET status = ?, answer = ?, error = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'running')")
    .bind(body.status, body.status === "complete" ? answer : null, body.status === "failed" ? (error || "Inference failed.") : null, now, body.taskId).run();
  if ((update.meta?.changes || 0) > 0 && body.status === "complete") {
    const conversation = await env.DB.prepare("SELECT messages_json FROM conversations WHERE id = ?").bind(task.conversation_id).first<{ messages_json: string }>();
    if (conversation) {
      const messages = JSON.parse(conversation.messages_json) as Array<{ role: string; content: string }>;
      messages.push({ role: "assistant", content: answer });
      await env.DB.prepare("UPDATE conversations SET messages_json = ?, updated_at = ? WHERE id = ?").bind(JSON.stringify(messages), now, task.conversation_id).run();
    }
  }
  return json({ ok: true });
}
