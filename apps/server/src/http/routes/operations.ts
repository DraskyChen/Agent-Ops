import type { ApiErrorResponse } from "@agent-ops/contracts";
import type { FastifyInstance } from "fastify";

import type { HumanAuth } from "../../application/auth.js";
import {
  InvalidOperationsQueryError,
  type OperationsService,
} from "../../application/operations.js";
import { requirePrincipal } from "../auth-context.js";

export function registerOperationsRoute(
  app: FastifyInstance,
  operations: OperationsService,
  humanAuth: HumanAuth,
): void {
  app.get<{ Querystring: { windowHours?: string } }>(
    "/api/v1/operations/ingest",
    async (request, reply) => {
      const principal = await requirePrincipal(humanAuth, request, reply);
      if (principal === null) {
        return;
      }
      try {
        const windowHours =
          request.query.windowHours === undefined
            ? 24
            : Number(request.query.windowHours);
        return await operations.ingestHealth(windowHours);
      } catch (error) {
        if (error instanceof InvalidOperationsQueryError) {
          return reply.code(400).send({
            code: "OPERATIONS_QUERY_INVALID",
            message: error.message,
          } satisfies ApiErrorResponse);
        }
        throw error;
      }
    },
  );
}
