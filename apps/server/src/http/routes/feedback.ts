import type {
  ApiErrorResponse,
  FeedbackWriteRequest,
} from "@agent-ops/contracts";
import type { FastifyInstance } from "fastify";

import type { IngestRequestAuthorizer } from "../../application/dependencies.js";
import {
  FeedbackConflictError,
  FeedbackTraceNotFoundError,
  FeedbackValidationError,
  type FeedbackService,
} from "../../application/feedback.js";

export function registerFeedbackRoute(
  app: FastifyInstance,
  feedback: FeedbackService,
  authorizeIngest: IngestRequestAuthorizer,
): void {
  app.post<{ Body: FeedbackWriteRequest }>(
    "/api/v1/feedback",
    async (request, reply) => {
      const apiKey = request.headers["x-api-key"];
      if (
        !authorizeIngest({
          authorization: request.headers.authorization,
          apiKey: typeof apiKey === "string" ? apiKey : apiKey?.[0],
        })
      ) {
        return reply.code(401).send({
          code: "FEEDBACK_UNAUTHORIZED",
          message: "Invalid application credential",
        } satisfies ApiErrorResponse);
      }

      try {
        const result = await feedback.create(request.body);
        return reply.code(result.created ? 201 : 200).send(result);
      } catch (error) {
        if (error instanceof FeedbackValidationError) {
          return reply.code(400).send({
            code: "FEEDBACK_INVALID",
            message: error.message,
          } satisfies ApiErrorResponse);
        }
        if (error instanceof FeedbackTraceNotFoundError) {
          return reply.code(404).send({
            code: "TRACE_NOT_FOUND",
            message: "Trace not found",
          } satisfies ApiErrorResponse);
        }
        if (error instanceof FeedbackConflictError) {
          return reply.code(409).send({
            code: "FEEDBACK_EVENT_CONFLICT",
            message: error.message,
          } satisfies ApiErrorResponse);
        }
        throw error;
      }
    },
  );
}
