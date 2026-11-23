import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  safeEqual, issueSession, requireSession, requireInternal,
  parseJsonBody, dispatchInference
} from "../.test-build/functions/_shared.js";

test("constant-time comparison accepts equal secrets and rejects different values", () => {
  assert.equal(safeEqual("same-secret", "same-secret"), true);
  assert.equal(safeEqual("same-secret", "different-secret"), false);
  assert.equal(safeEqual("short", "longer"), false);
});

test("signed browser sessions verify and tampering is rejected", async () => {
  const secret = "session-secret-for-tests-that-is-long-enough-123456";
  const token = await issueSession(secret);
  const request = new Request("https://quantum.test/api/conversations", {
    headers: { authorization: "Bearer " + token }
  });
  assert.equal(await requireSession(request, { SESSION_SECRET: secret }), null);
  const [payload, signature] = token.split(".");
  const changed = payload + "." + (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  const invalid = new Request("https://quantum.test/api/conversations", {
    headers: { authorization: "Bearer " + changed }
  });
  assert.ok(await requireSession(invalid, { SESSION_SECRET: secret }));
});

test("internal callback rejects missing or incorrect shared secrets", () => {
  const env = { INTERNAL_API_SECRET: "internal-secret-for-tests-that-is-long-enough-123" };
  assert.equal(requireInternal(new Request("https://quantum.test"), env)?.status, 403);
  assert.equal(requireInternal(new Request("https://quantum.test", {
    headers: { authorization: "Bearer wrong" }
  }), env)?.status, 403);
  assert.equal(requireInternal(new Request("https://quantum.test", {
    headers: { authorization: "Bearer " + env.INTERNAL_API_SECRET }
  }), env), null);
});

test("request JSON reader enforces a hard byte limit", async () => {
  const request = new Request("https://quantum.test", { method: "POST", body: JSON.stringify({ value: "x".repeat(300) }) });
  await assert.rejects(() => parseJsonBody(request, 100), /too large/i);
  const valid = new Request("https://quantum.test", { method: "POST", body: JSON.stringify({ ok: true }) });
  assert.deepEqual(await parseJsonBody(valid), { ok: true });
});

test("GitHub App PKCS#1 key signs a JWT and dispatches only the Quantum workflow", async () => {
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs1", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/access_tokens")) {
      return new Response(JSON.stringify({ token: "temporary-installation-token" }), {
        status: 201, headers: { "content-type": "application/json" }
      });
    }
    if (url.endsWith("/dispatches")) return new Response(null, { status: 204 });
    return new Response("unexpected endpoint", { status: 404 });
  };
  try {
    await dispatchInference({
      GITHUB_APP_ID: "123456",
      GITHUB_INSTALLATION_ID: "987654",
      GITHUB_APP_PRIVATE_KEY: privateKey
    }, "test-task-123");
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /app\/installations\/987654\/access_tokens$/);
    assert.match(calls[1].url, /w3356jchooks-cloud\/Quantum-AI\/actions\/workflows\/quantum-inference.yml\/dispatches$/);
    assert.match(calls[1].init.headers.authorization, /temporary-installation-token/);
    assert.deepEqual(JSON.parse(calls[1].init.body), {
      ref: "main",
      inputs: { task_id: "test-task-123", api_url: "https://quantum-ai-w3356jchooks.pages.dev" }
    });
    const permissions = JSON.parse(calls[0].init.body);
    assert.deepEqual(permissions.permissions, { actions: "write" });
    assert.deepEqual(permissions.repositories, ["Quantum-AI"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
