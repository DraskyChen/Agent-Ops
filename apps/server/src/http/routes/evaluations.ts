import type {
  ApiErrorResponse,
  EvaluationCreateRequest,
} from "@agent-ops/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";

import type { HumanAuth } from "../../application/auth.js";
import {
  EvaluationCaseAmbiguousError,
  EvaluationNotFoundError,
  EvaluationValidationError,
  type EvaluationService,
} from "../../application/evaluations.js";
import { requirePrincipal } from "../auth-context.js";

export function registerEvaluationRoutes(
  app: FastifyInstance,
  evaluations: EvaluationService,
  humanAuth: HumanAuth,
): void {
  app.get("/api/v1/evaluations", async (request, reply) => {
    const principal = await requirePrincipal(humanAuth, request, reply);
    if (principal === null) {
      return;
    }
    return evaluations.list();
  });

  app.get<{ Params: { evaluationId: string } }>(
    "/api/v1/evaluations/:evaluationId",
    async (request, reply) => {
      const principal = await requirePrincipal(humanAuth, request, reply);
      if (principal === null) {
        return;
      }
      const evaluation = await evaluations.get(
        request.params.evaluationId,
      );
      if (evaluation === null) {
        return reply.code(404).send({
          code: "EVALUATION_NOT_FOUND",
          message: "Evaluation not found",
        } satisfies ApiErrorResponse);
      }
      return evaluation;
    },
  );

  app.post<{ Body: EvaluationCreateRequest }>(
    "/api/v1/evaluations",
    async (request, reply) => {
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
        return reply.code(201).send(
          await evaluations.create(principal, request.body),
        );
      } catch (error) {
        return sendEvaluationError(reply, error);
      }
    },
  );

  app.post<{ Params: { evaluationId: string } }>(
    "/api/v1/evaluations/:evaluationId/cancel",
    async (request, reply) => {
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
        const evaluation = await evaluations.cancel(
          request.params.evaluationId,
        );
        if (evaluation === null) {
          throw new EvaluationNotFoundError();
        }
        return evaluation;
      } catch (error) {
        return sendEvaluationError(reply, error);
      }
    },
  );
}

function sendEvaluationError(reply: FastifyReply, error: unknown) {
  if (error instanceof EvaluationValidationError) {
    return reply.code(400).send({
      code: "EVALUATION_INVALID",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  if (error instanceof EvaluationCaseAmbiguousError) {
    return reply.code(422).send({
      code: "EVALUATION_CASE_AMBIGUOUS",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  if (error instanceof EvaluationNotFoundError) {
    return reply.code(404).send({
      code: "EVALUATION_NOT_FOUND",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  throw error;
}
