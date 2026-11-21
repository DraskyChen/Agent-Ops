import type {
  ApiErrorResponse,
  TraceListQuery,
  TraceListResponse,
} from "@agent-ops/contracts";
import type { FastifyInstance } from "fastify";

import type { TraceQueryService } from "../../application/traces.js";

export function registerTraceRoutes(
  app: FastifyInstance,
  traces: TraceQueryService,
): void {
  app.get<{ Querystring: TraceListQuery }>(
    "/api/v1/traces",
    async (request) => {
      const response: TraceListResponse = {
        items: await traces.list(request.query),
      };
      return response;
    },
  );

  app.get<{ Params: { traceId: string } }>(
    "/api/v1/traces/:traceId",
    async (request, reply) => {
      const trace = await traces.get(request.params.traceId);
      if (trace === null) {
        const error: ApiErrorResponse = {
          code: "TRACE_NOT_FOUND",
          message: "Trace not found",
        };
        return reply.code(404).send(error);
      }
      return trace;
    },
  );
}
