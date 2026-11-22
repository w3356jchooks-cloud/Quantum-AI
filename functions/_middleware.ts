import { jwtVerify, createRemoteJWKSet } from "jose";

type Env = { CF_ACCESS_TEAM_DOMAIN?: string; CF_ACCESS_AUD?: string };

let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;
let cachedDomain = "";

function accessKeys(domain: string) {
  if (!cachedJwks || cachedDomain !== domain) {
    const normalized = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
    cachedJwks = createRemoteJWKSet(new URL(`https://${normalized}/cdn-cgi/access/certs`));
    cachedDomain = normalized;
  }
  return cachedJwks;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const path = new URL(context.request.url).pathname;
  if (path === "/api/health") return context.next();

  const domain = context.env.CF_ACCESS_TEAM_DOMAIN;
  const audience = context.env.CF_ACCESS_AUD;
  if (!domain || !audience) {
    return Response.json({ error: "Authentication gateway is not configured." }, { status: 503 });
  }

  const token = context.request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return Response.json({ error: "Authentication required." }, { status: 401 });

  try {
    await jwtVerify(token, accessKeys(domain), {
      issuer: `https://${domain.replace(/^https?:\/\//, "").replace(/\/$/, "")}`,
      audience,
    });
  } catch {
    return Response.json({ error: "Invalid or expired access session." }, { status: 401 });
  }
  return context.next();
};
