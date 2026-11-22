export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}
export interface D1Database { prepare(sql: string): D1Statement; }
export interface Env {
  DB: D1Database;
  APP_ACCESS_CODE: string;
  SESSION_SECRET: string;
  INTERNAL_API_SECRET: string;
  GITHUB_APP_ID: string;
  GITHUB_INSTALLATION_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
}
const encoder = new TextEncoder();
export const SYSTEM_PROMPT = "You are Quantum, a helpful AI assistant. Be accurate, clear, and honest about uncertainty. If you do not know something, say so. Do not claim to have browsed the web or learned new facts unless a verified source was supplied.";
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
export function b64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
export function decodeB64url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, c => c.charCodeAt(0));
}
export function safeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a), right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
export async function issueSession(secret: string): Promise<string> {
  const payload = b64url(encoder.encode(JSON.stringify({ sub: "quantum-owner", exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 })));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload)));
  return payload + "." + b64url(signature);
}
export async function requireSession(request: Request, env: Env): Promise<Response | null> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const parts = token.split(".");
  if (parts.length !== 2 || !env.SESSION_SECRET) return json({ error: "Authentication required." }, 401);
  try {
    const valid = await crypto.subtle.verify("HMAC", await hmacKey(env.SESSION_SECRET), decodeB64url(parts[1]), encoder.encode(parts[0]));
    const payload = JSON.parse(new TextDecoder().decode(decodeB64url(parts[0]))) as { sub?: string; exp?: number };
    if (!valid || payload.sub !== "quantum-owner" || !payload.exp || payload.exp < Date.now() / 1000) return json({ error: "Session expired. Sign in again." }, 401);
    return null;
  } catch { return json({ error: "Invalid session." }, 401); }
}
export function requireInternal(request: Request, env: Env): Response | null {
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!env.INTERNAL_API_SECRET || !safeEqual(supplied, env.INTERNAL_API_SECRET)) return json({ error: "Forbidden." }, 403);
  return null;
}
function derLength(length: number): Uint8Array {
  if (length < 128) return Uint8Array.of(length);
  const bytes: number[] = [];
  let n = length;
  while (n > 0) { bytes.unshift(n & 255); n >>>= 8; }
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}
function der(tag: number, value: Uint8Array): Uint8Array {
  return new Uint8Array([tag, ...derLength(value.length), ...value]);
}
function pemBytes(pem: string): Uint8Array {
  const isPkcs1 = pem.includes("BEGIN RSA PRIVATE KEY");
  const body = pem.replace(/-----BEGIN [A-Z ]+-----|-----END [A-Z ]+-----|\\s/g, "");
  const binary = atob(body);
  const raw = Uint8Array.from(binary, c => c.charCodeAt(0));
  if (!isPkcs1) return raw;
  // GitHub App private keys are PKCS#1 PEM; WebCrypto imports PKCS#8.
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const algorithm = Uint8Array.of(0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00);
  return der(0x30, new Uint8Array([...version, ...algorithm, ...der(0x04, raw)]));
}

export async function githubInstallationToken(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claims = b64url(encoder.encode(JSON.stringify({ iat: now - 30, exp: now + 540, iss: env.GITHUB_APP_ID })));
  const unsigned = header + "." + claims;
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(env.GITHUB_APP_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned)));
  const response = await fetch("https://api.github.com/app/installations/" + encodeURIComponent(env.GITHUB_INSTALLATION_ID) + "/access_tokens", {
    method: "POST",
    headers: { authorization: "Bearer " + unsigned + "." + b64url(signature), accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28", "user-agent": "Quantum-AI" },
    body: JSON.stringify({ repositories: ["Quantum-AI"], permissions: { actions: "write" } })
  });
  if (!response.ok) throw new Error("GitHub App token request failed (" + response.status + ").");
  const data = await response.json() as { token?: string };
  if (!data.token) throw new Error("GitHub did not return an installation token.");
  return data.token;
}
export async function dispatchInference(env: Env, taskId: string): Promise<void> {
  const token = await githubInstallationToken(env);
  const response = await fetch("https://api.github.com/repos/w3356jchooks-cloud/Quantum-AI/actions/workflows/quantum-inference.yml/dispatches", {
    method: "POST",
    headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28", "user-agent": "Quantum-AI" },
    body: JSON.stringify({ ref: "main", inputs: { task_id: taskId } })
  });
  if (!response.ok) throw new Error("GitHub could not queue the inference job (" + response.status + ").");
}
export function parseJsonBody<T>(request: Request): Promise<T> {
  const length = Number(request.headers.get("content-length") || "0");
  if (length > 48_000) throw new Error("Request is too large.");
  return request.json() as Promise<T>;
}
