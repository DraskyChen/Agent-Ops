import type {
  ApiErrorResponse,
  TraceCandidateDismissRequest,
} from "@agent-ops/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";

import type {
  CandidateService,
} from "../../application/candidates.js";
import {
  CandidateNotFoundError,
  CandidateValidationError,
} from "../../application/candidates.js";
import type { HumanAuth } from "../../application/auth.js";
import { requirePrincipal } from "../auth-context.js";

export function registerCandidateRoutes(
  app: FastifyInstance,
  candidates: CandidateService,
  humanAuth: HumanAuth,
): void {
  app.get("/api/v1/candidates", async (request, reply) => {
    const principal = await requirePrincipal(humanAuth, request, reply);
    if (principal === null) {
      return;
    }
    return candidates.list();
  });

  app.post<{
    Params: { traceId: string };
    Body: TraceCandidateDismissRequest;
  }>(
    "/api/v1/candidates/:traceId/dismiss",
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
        return await candidates.dismiss(
          request.params.traceId,
          principal,
          request.body ?? {},
        );
      } catch (error) {
        return sendCandidateError(reply, error);
      }
    },
  );

  app.post<{ Params: { traceId: string } }>(
    "/api/v1/candidates/:traceId/restore",
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
        return await candidates.restore(request.params.traceId);
      } catch (error) {
        return sendCandidateError(reply, error);
      }
    },
  );
}

function sendCandidateError(reply: FastifyReply, error: unknown) {
  if (error instanceof CandidateValidationError) {
    return reply.code(400).send({
      code: "CANDIDATE_INVALID",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  if (error instanceof CandidateNotFoundError) {
    return reply.code(404).send({
      code: "CANDIDATE_NOT_FOUND",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  throw error;
}
