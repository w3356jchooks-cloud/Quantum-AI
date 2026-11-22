import { Env, json, requireSession } from "../../_shared.js";
interface Context { request: Request; env: Env; params: { id: string }; }
export async function onRequestDelete({ request, env, params }: Context): Promise<Response> {
  const denied = await requireSession(request, env); if (denied) return denied;
  await env.DB.prepare("DELETE FROM knowledge WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
