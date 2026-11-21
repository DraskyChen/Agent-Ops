import type {
  ApiErrorResponse,
  ReviewWriteRequest,
} from "@agent-ops/contracts";
import type { FastifyInstance } from "fastify";

import type { HumanAuth } from "../../application/auth.js";
import {
  ReviewTraceNotFoundError,
  ReviewValidationError,
  type ReviewService,
} from "../../application/reviews.js";
import { requirePrincipal } from "../auth-context.js";

export function registerReviewRoute(
  app: FastifyInstance,
  reviews: ReviewService,
  humanAuth: HumanAuth,
): void {
  app.post<{
    Params: { traceId: string };
    Body: ReviewWriteRequest;
  }>("/api/v1/traces/:traceId/reviews", async (request, reply) => {
    const principal = await requirePrincipal(
      humanAuth,
      request,
      reply,
      "reviewer",
    );
    if (principal === null) {
      return;
    }
    try {
      const review = await reviews.create(
        request.params.traceId,
        principal,
        request.body,
      );
      return reply.code(201).send(review);
    } catch (error) {
      if (error instanceof ReviewValidationError) {
        return reply.code(400).send({
          code: "REVIEW_INVALID",
          message: error.message,
        } satisfies ApiErrorResponse);
      }
      if (error instanceof ReviewTraceNotFoundError) {
        return reply.code(404).send({
          code: "TRACE_NOT_FOUND",
          message: "Trace not found",
        } satisfies ApiErrorResponse);
      }
      throw error;
    }
  });
}
