import type {
  ApiErrorResponse,
  PromptVersionCreateRequest,
  PromptVersionUpdateRequest,
} from "@agent-ops/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";

import type { PromptRegistryService } from "../../application/prompt-registry.js";
import {
  PromptRegistryValidationError,
  PromptVersionConflictError,
  PromptVersionNotFoundError,
} from "../../application/prompt-registry.js";
import type { HumanAuth } from "../../application/auth.js";
import { requirePrincipal } from "../auth-context.js";

export function registerPromptRoutes(
  app: FastifyInstance,
  prompts: PromptRegistryService,
  humanAuth: HumanAuth,
): void {
  app.get("/api/v1/prompts", async (request, reply) => {
    const principal = await requirePrincipal(humanAuth, request, reply);
    if (principal === null) {
      return;
    }
    return prompts.list();
  });

  app.post<{ Body: PromptVersionCreateRequest }>(
    "/api/v1/prompts",
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
          await prompts.create(principal, request.body),
        );
      } catch (error) {
        return sendPromptError(reply, error);
      }
    },
  );

  app.get<{ Params: { promptVersion: string } }>(
    "/api/v1/prompts/:promptVersion",
    async (request, reply) => {
      const principal = await requirePrincipal(humanAuth, request, reply);
      if (principal === null) {
        return;
      }
      try {
        const detail = await prompts.get(request.params.promptVersion);
        if (detail === null) {
          throw new PromptVersionNotFoundError();
        }
        return detail;
      } catch (error) {
        return sendPromptError(reply, error);
      }
    },
  );

  app.patch<{
    Params: { promptVersion: string };
    Body: PromptVersionUpdateRequest;
  }>(
    "/api/v1/prompts/:promptVersion",
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
        return await prompts.update(
          principal,
          request.params.promptVersion,
          request.body,
        );
      } catch (error) {
        return sendPromptError(reply, error);
      }
    },
  );
}

function sendPromptError(reply: FastifyReply, error: unknown) {
  if (error instanceof PromptRegistryValidationError) {
    return reply.code(400).send({
      code: "PROMPT_REGISTRY_INVALID",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  if (error instanceof PromptVersionConflictError) {
    return reply.code(409).send({
      code: "PROMPT_VERSION_CONFLICT",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  if (error instanceof PromptVersionNotFoundError) {
    return reply.code(404).send({
      code: "PROMPT_VERSION_NOT_FOUND",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  throw error;
}
