import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { onRequestPost as authenticate } from "../.test-build/functions/api/auth.js";
import { onRequestPost as createChat } from "../.test-build/functions/api/chat.js";
import { onRequestGet as readInternalTask } from "../.test-build/functions/api/internal/tasks/[id].js";
import { onRequestPost as completeTask } from "../.test-build/functions/api/internal/complete.js";
import { onRequestGet as readTask } from "../.test-build/functions/api/tasks/[id].js";
import { onRequestGet as listConversations } from "../.test-build/functions/api/conversations.js";
import { onRequestGet as readConversation } from "../.test-build/functions/api/conversations/[id].js";

class FakeD1 {
  conversations = new Map();
  tasks = new Map();
  attempts = [];
  prepare(sql) {
    let values = [];
    const db = this;
    return {
      bind(...args) { values = args; return this; },
      async first() {
        if (sql.includes("COUNT(*) AS count FROM auth_attempts")) {
          return { count: db.attempts.filter(x => x.ip_hash === values[0] && x.created_at > values[1]).length };
        }
        if (sql.includes("FROM tasks WHERE id = ?")) {
          const task = db.tasks.get(values[0]);
          if (!task) return null;
          if (sql.includes("conversation_id, messages_json")) return { conversation_id: task.conversation_id, messages_json: task.messages_json };
          if (sql.includes("id, status, messages_json")) return { id: task.id, status: task.status, messages_json: task.messages_json };
          return { id: task.id, status: task.status, answer: task.answer, error: task.error, created_at: task.created_at, updated_at: task.updated_at };
        }
        if (sql.includes("FROM conversations WHERE id = ?")) {
          const row = db.conversations.get(values[0]);
          return row ? { messages_json: row.messages_json, id: row.id, title: row.title, updated_at: row.updated_at } : null;
        }
        if (sql.includes("SELECT 1 AS ok")) return { ok: 1 };
        return null;
      },
      async all() {
        if (sql.includes("FROM conversations ORDER BY")) {
          return { results: [...db.conversations.values()].sort((a,b) => b.updated_at-a.updated_at).map(({id,title,updated_at})=>({id,title,updated_at})) };
        }
        return { results: [] };
      },
      async run() {
        if (sql.startsWith("INSERT INTO auth_attempts")) db.attempts.push({ ip_hash: values[0], created_at: values[1] });
        else if (sql.startsWith("DELETE FROM auth_attempts")) db.attempts = db.attempts.filter(x => x.created_at >= values[0]);
        else if (sql.startsWith("INSERT INTO conversations")) {
          const [id,title,messages_json,created_at,updated_at] = values;
          const previous = db.conversations.get(id);
          db.conversations.set(id,{id,title,messages_json,created_at:previous?.created_at ?? created_at,updated_at});
        } else if (sql.startsWith("INSERT INTO tasks")) {
          const [id,conversation_id,messages_json,created_at,updated_at] = values;
          db.tasks.set(id,{id,conversation_id,messages_json,status:"queued",answer:null,error:null,created_at,updated_at});
        } else if (sql.includes("SET status = 'running'")) {
          const task=db.tasks.get(values[1]); if(task && task.status==="queued"){task.status="running";task.updated_at=values[0];}
        } else if (sql.startsWith("UPDATE tasks SET status = ?")) {
          const [status,answer,error,updated_at,id]=values, task=db.tasks.get(id);
          if(task && ["queued","running"].includes(task.status)){Object.assign(task,{status,answer,error,updated_at});return {meta:{changes:1}};}
          return {meta:{changes:0}};
        } else if (sql.startsWith("UPDATE conversations SET messages_json")) {
          const [messages_json,updated_at,id]=values, row=db.conversations.get(id);
          if(row) Object.assign(row,{messages_json,updated_at});
        } else if (sql.startsWith("DELETE FROM tasks")) {
          for(const [id,task] of db.tasks) if(task.conversation_id===values[0]) db.tasks.delete(id);
        } else if (sql.startsWith("DELETE FROM conversations")) db.conversations.delete(values[0]);
        return {meta:{changes:1}};
      }
    };
  }
}
const privateKey = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs1", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" }
}).privateKey;
const env = {
  DB: new FakeD1(),
  APP_ACCESS_CODE: "quantum-test-access-code-should-be-long",
  SESSION_SECRET: "quantum-test-session-secret-at-least-thirty-two-characters",
  INTERNAL_API_SECRET: "quantum-test-internal-secret-at-least-thirty-two-characters",
  GITHUB_APP_ID: "123456",
  GITHUB_INSTALLATION_ID: "987654",
  GITHUB_APP_PRIVATE_KEY: privateKey
};
const jsonRequest = (url, body, headers = {}) => new Request(url, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body)
});

test("one complete gateway-to-workflow-callback conversation round trip", async () => {
  const originalFetch = globalThis.fetch;
  const githubCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if(url.includes("en.wikipedia.org")) return new Response(JSON.stringify({query:{search:[]}}),{status:200,headers:{"content-type":"application/json"}});
    githubCalls.push({url,init});
    if(url.endsWith("/access_tokens")) return new Response(JSON.stringify({token:"short-lived-test-token"}),{status:201,headers:{"content-type":"application/json"}});
    if(url.endsWith("/dispatches")) return new Response(null,{status:204});
    return new Response("unexpected endpoint",{status:404});
  };
  try {
    const authResponse = await authenticate({request:jsonRequest("https://quantum.test/api/auth",{accessCode:env.APP_ACCESS_CODE}),env});
    assert.equal(authResponse.status,200);
    const {token}=await authResponse.json();
    assert.ok(token);
    const conversationId="123e4567-e89b-12d3-a456-426614174000";
    const messages=[{role:"user",content:"Say hello in one sentence."}];
    const chatResponse=await createChat({request:jsonRequest("https://quantum.test/api/chat",{conversationId,messages},{authorization:"Bearer "+token}),env});
    assert.equal(chatResponse.status,202);
    const {taskId}=await chatResponse.json();
    assert.ok(taskId);
    assert.equal(githubCalls.length,2);
    const internalResponse=await readInternalTask({request:new Request("https://quantum.test/api/internal/tasks/"+taskId,{headers:{authorization:"Bearer "+env.INTERNAL_API_SECRET}}),env,params:{id:taskId}});
    assert.equal(internalResponse.status,200);
    const internal=await internalResponse.json();
    assert.equal(internal.messages.at(-1).content,messages[0].content);
    const callback=await completeTask({request:jsonRequest("https://quantum.test/api/internal/complete",{taskId,status:"complete",answer:"Hello from SmolLM2."},{authorization:"Bearer "+env.INTERNAL_API_SECRET}),env});
    assert.equal(callback.status,200);
    const taskResponse=await readTask({request:new Request("https://quantum.test/api/tasks/"+taskId,{headers:{authorization:"Bearer "+token}}),env,params:{id:taskId}});
    assert.equal(taskResponse.status,200);
    assert.equal((await taskResponse.json()).status,"complete");
    const duplicateCallback=await completeTask({request:jsonRequest("https://quantum.test/api/internal/complete",{taskId,status:"complete",answer:"Duplicate must not overwrite."},{authorization:"Bearer "+env.INTERNAL_API_SECRET}),env});
    assert.equal(duplicateCallback.status,200);
    const listResponse=await listConversations({request:new Request("https://quantum.test/api/conversations",{headers:{authorization:"Bearer "+token}}),env});
    assert.equal((await listResponse.json()).conversations.length,1);
    const conversationResponse=await readConversation({request:new Request("https://quantum.test/api/conversations/"+conversationId,{headers:{authorization:"Bearer "+token}}),env,params:{id:conversationId}});
    const saved=await conversationResponse.json();
    assert.equal(saved.messages.at(-1).content,"Hello from SmolLM2.");
    assert.equal(saved.messages.filter(message=>message.role==="assistant").length,1);
  } finally {
    globalThis.fetch=originalFetch;
  }
});
