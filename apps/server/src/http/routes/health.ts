import type { HealthResponse } from "@agent-ops/contracts";
import type { FastifyInstance } from "fastify";
import { SCHEMA_VERSION } from "@agent-ops/contracts";

export function registerHealthRoute(
  app: FastifyInstance,
  healthCheck: () => Promise<void>,
): void {
  app.get("/healthz", async (_request, reply) => {
    try {
      await healthCheck();
      const response: HealthResponse = {
        status: "ok",
        schemaVersion: SCHEMA_VERSION,
        database: "connected",
      };
      return response;
    } catch {
      const response: HealthResponse = {
        status: "degraded",
        schemaVersion: SCHEMA_VERSION,
        database: "unavailable",
      };
      return reply.code(503).send(response);
    }
  });
}
