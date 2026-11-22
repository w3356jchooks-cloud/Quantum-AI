import { Env, json, requireSession, dispatchInference, parseJsonBody, SYSTEM_PROMPT } from "../_shared.js";
interface Context { request: Request; env: Env; }
type ChatMessage = { role: "user" | "assistant"; content: string };
interface Body { conversationId?: string; messages?: ChatMessage[]; }
export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const denied = await requireSession(request, env); if (denied) return denied;
  let body: Body;
  try { body = await parseJsonBody<Body>(request); } catch { return json({ error: "Invalid or oversized request." }, 400); }
  const conversationId = typeof body.conversationId === "string" && /^[a-zA-Z0-9-]{16,64}$/.test(body.conversationId) ? body.conversationId : "";
  const messages = body.messages;
  if (!conversationId || !Array.isArray(messages) || messages.length < 1 || messages.length > 50) return json({ error: "A conversation ID and 1–50 messages are required." }, 400);
  let total = 0;
  for (const message of messages) {
    if (!message || !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || message.content.length > 4000) return json({ error: "Invalid message format." }, 400);
    total += message.content.length;
  }
  if (total > 32_000 || messages[messages.length - 1].role !== "user") return json({ error: "Conversation is too large or the latest message is not from the user." }, 400);
  const taskId = crypto.randomUUID(), now = Math.floor(Date.now() / 1000);
  const taskMessages = [{ role: "system", content: SYSTEM_PROMPT }, ...messages.slice(-20)];
  const firstUser = messages.find(m => m.role === "user")?.content || "New conversation";
  const title = firstUser.slice(0, 72);
  await env.DB.prepare("INSERT INTO conversations (id, title, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET messages_json = excluded.messages_json, updated_at = excluded.updated_at")
    .bind(conversationId, title, JSON.stringify(messages), now, now).run();
  await env.DB.prepare("INSERT INTO tasks (id, conversation_id, status, messages_json, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?)")
    .bind(taskId, conversationId, JSON.stringify(taskMessages), now, now).run();
  try {
    await dispatchInference(env, taskId);
    return json({ taskId, status: "queued", conversationId }, 202);
  } catch (error) {
    console.error("Quantum dispatch failed:", error);
    await env.DB.prepare("UPDATE tasks SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind("The model job could not be queued. Check the Quantum GitHub connection.", now, taskId).run();
    return json({ error: "The model job could not be queued. The deployment may still need its GitHub App connection." }, 503);
  }
}
