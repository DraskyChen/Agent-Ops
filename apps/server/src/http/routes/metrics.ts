import type {
  ApiErrorResponse,
  MetricsBreakdownQuery,
  MetricsQuery,
} from "@agent-ops/contracts";
import type { FastifyInstance } from "fastify";

import type { HumanAuth } from "../../application/auth.js";
import {
  InvalidMetricsQueryError,
  type MetricsService,
} from "../../application/metrics.js";
import { requirePrincipal } from "../auth-context.js";

export function registerMetricsRoutes(
  app: FastifyInstance,
  metrics: MetricsService,
  humanAuth: HumanAuth,
): void {
  app.get<{ Querystring: MetricsQuery }>(
    "/api/v1/metrics/overview",
    async (request, reply) => {
      const principal = await requirePrincipal(humanAuth, request, reply);
      if (principal === null) {
        return;
      }
      try {
        return await metrics.overview(request.query);
      } catch (error) {
        return metricsError(reply, error);
      }
    },
  );

  app.get<{ Querystring: MetricsBreakdownQuery }>(
    "/api/v1/metrics/breakdown",
    async (request, reply) => {
      const principal = await requirePrincipal(humanAuth, request, reply);
      if (principal === null) {
        return;
      }
      try {
        return await metrics.breakdown(request.query);
      } catch (error) {
        return metricsError(reply, error);
      }
    },
  );
}

function metricsError(reply: { code: (status: number) => { send: (body: ApiErrorResponse) => unknown } }, error: unknown) {
  if (error instanceof InvalidMetricsQueryError) {
    return reply.code(400).send({
      code: "METRICS_QUERY_INVALID",
      message: error.message,
    });
  }
  throw error;
}
