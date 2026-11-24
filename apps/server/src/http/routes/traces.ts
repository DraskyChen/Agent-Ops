import type {
  ApiErrorResponse,
  SessionListQuery,
  TraceListQuery,
} from "@agent-ops/contracts";
import type { FastifyInstance } from "fastify";

import {
  InvalidTraceQueryError,
  type TraceQueryService,
} from "../../application/traces.js";
import type { HumanAuth } from "../../application/auth.js";
import { requirePrincipal } from "../auth-context.js";

export function registerTraceRoutes(
  app: FastifyInstance,
  traces: TraceQueryService,
  humanAuth: HumanAuth,
): void {
  app.get<{ Querystring: TraceListQuery }>(
    "/api/v1/traces",
    async (request, reply) => {
      const principal = await requirePrincipal(humanAuth, request, reply);
      if (principal === null) {
        return;
      }
      try {
        return await traces.list(request.query);
      } catch (error) {
        if (error instanceof InvalidTraceQueryError) {
          return reply.code(400).send({
            code: "TRACE_QUERY_INVALID",
            message: error.message,
          } satisfies ApiErrorResponse);
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { traceId: string } }>(
    "/api/v1/traces/:traceId",
    async (request, reply) => {
      const principal = await requirePrincipal(humanAuth, request, reply);
      if (principal === null) {
        return;
      }
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

  app.get<{ Querystring: SessionListQuery }>(
    "/api/v1/sessions",
    async (request, reply) => {
      const principal = await requirePrincipal(humanAuth, request, reply);
      if (principal === null) {
        return;
      }
      try {
        return await traces.listSessions(request.query);
      } catch (error) {
        if (error instanceof InvalidTraceQueryError) {
          return reply.code(400).send({
            code: "SESSION_QUERY_INVALID",
            message: error.message,
          } satisfies ApiErrorResponse);
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    "/api/v1/sessions/:sessionId",
    async (request, reply) => {
      const principal = await requirePrincipal(humanAuth, request, reply);
      if (principal === null) {
        return;
      }
      try {
        const session = await traces.getSession(request.params.sessionId);
        if (session === null) {
          return reply.code(404).send({
            code: "SESSION_NOT_FOUND",
            message: "Session not found",
          } satisfies ApiErrorResponse);
        }
        return session;
      } catch (error) {
        if (error instanceof InvalidTraceQueryError) {
          return reply.code(400).send({
            code: "SESSION_QUERY_INVALID",
            message: error.message,
          } satisfies ApiErrorResponse);
        }
        throw error;
      }
    },
  );
}
