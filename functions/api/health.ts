type Env = {
  DB?: D1Database;
  CHECKPOINTS?: R2Bucket;
};

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return Response.json({
    service: "quantum-api",
    status: "online",
    mode: "foundation",
    integrations: {
      database: Boolean(env.DB),
      checkpointStorage: Boolean(env.CHECKPOINTS),
    },
    inference: "not-configured",
    timestamp: new Date().toISOString(),
  }, {
    headers: { "Cache-Control": "no-store" },
  });
};
