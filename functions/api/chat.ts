import { Env, json, requireSession, dispatchInference, parseJsonBody, SYSTEM_PROMPT } from "../_shared.js";
import { acquireWikipedia, findKnowledge, knowledgeContext, knowledgeTerms, KnowledgeSource } from "../_knowledge.js";
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
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("UPDATE tasks SET status = 'failed', error = ?, updated_at = ? WHERE status IN ('queued', 'running') AND updated_at < ?")
    .bind("Inference timed out before completion.", now, now - 2700).run();
  const activeTasks = await env.DB.prepare("SELECT COUNT(*) AS count FROM tasks WHERE status IN ('queued', 'running')").first<{ count: number }>();
  if ((activeTasks?.count || 0) >= 2) return json({ error: "Quantum already has two active inference jobs. Wait for one to finish." }, 429);
  const recentTasks = await env.DB.prepare("SELECT COUNT(*) AS count FROM tasks WHERE created_at > ?").bind(now - 60).first<{ count: number }>();
  if ((recentTasks?.count || 0) >= 10) return json({ error: "Quantum chat is limited to ten prompts per minute." }, 429);
  const taskId = crypto.randomUUID();
  const latestQuery = messages[messages.length - 1].content;
  let sources: KnowledgeSource[] = [];
  try {
    sources = await findKnowledge(env, latestQuery);
    if (!sources.length && knowledgeTerms(latestQuery).length > 0) {
      const recent = await env.DB.prepare("SELECT COUNT(*) AS count FROM knowledge_requests WHERE created_at > ?").bind(now - 60).first<{ count: number }>();
      if ((recent?.count || 0) < 6) {
        await env.DB.prepare("INSERT INTO knowledge_requests (query, created_at) VALUES (?, ?)").bind(latestQuery.slice(0, 120), now).run();
        await acquireWikipedia(env, latestQuery);
        sources = await findKnowledge(env, latestQuery);
      }
    }
  } catch (error) {
    console.warn("Automatic knowledge acquisition unavailable; continuing without external context:", error);
    sources = [];
  }
  const cleanMessages = messages.slice(-20).map(message => ({ role: message.role, content: message.content }));
  const taskMessages = [{ role: "system", content: SYSTEM_PROMPT + knowledgeContext(sources) }, ...cleanMessages];
  const firstUser = messages.find(m => m.role === "user")?.content || "New conversation";
  const title = firstUser.slice(0, 72);
  await env.DB.prepare("INSERT INTO conversations (id, title, messages_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET messages_json = excluded.messages_json, updated_at = excluded.updated_at")
    .bind(conversationId, title, JSON.stringify(messages), now, now).run();
  const sourceRefs = sources.map(source => ({ title: source.title, url: source.source_url, source: source.source_name }));
  await env.DB.prepare("INSERT INTO tasks (id, conversation_id, status, messages_json, sources_json, created_at, updated_at) VALUES (?, ?, 'queued', ?, ?, ?, ?)")
    .bind(taskId, conversationId, JSON.stringify(taskMessages), JSON.stringify(sourceRefs), now, now).run();
  try {
    await dispatchInference(env, taskId);
    return json({ taskId, status: "queued", conversationId, knowledgeSources: sources.map(source => ({ title: source.title, url: source.source_url, source: source.source_name })) }, 202);
  } catch (error) {
    console.error("Quantum dispatch failed:", error);
    await env.DB.prepare("UPDATE tasks SET status = 'failed', error = ?, updated_at = ? WHERE id = ?").bind("The model job could not be queued. Check the Quantum GitHub connection.", now, taskId).run();
    return json({ error: "The model job could not be queued. The deployment may still need its GitHub App connection." }, 503);
  }
}
