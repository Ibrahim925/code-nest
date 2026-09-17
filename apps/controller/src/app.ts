import Fastify, { type FastifyInstance } from "fastify";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({
    service: "code-nest-controller",
    status: "ok",
  }));

  return app;
}
