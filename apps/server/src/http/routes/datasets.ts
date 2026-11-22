import type {
  ApiErrorResponse,
  DatasetCreateRequest,
  DatasetRevisionCreateRequest,
} from "@agent-ops/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";

import type { HumanAuth } from "../../application/auth.js";
import {
  DatasetCaseConflictError,
  DatasetNameConflictError,
  DatasetNotFoundError,
  DatasetTraceUnavailableError,
  DatasetValidationError,
  type DatasetService,
} from "../../application/datasets.js";
import { requirePrincipal } from "../auth-context.js";

export function registerDatasetRoutes(
  app: FastifyInstance,
  datasets: DatasetService,
  humanAuth: HumanAuth,
): void {
  app.get("/api/v1/datasets", async (request, reply) => {
    const principal = await requirePrincipal(humanAuth, request, reply);
    if (principal === null) {
      return;
    }
    return datasets.list();
  });

  app.get<{ Params: { datasetId: string } }>(
    "/api/v1/datasets/:datasetId",
    async (request, reply) => {
      const principal = await requirePrincipal(humanAuth, request, reply);
      if (principal === null) {
        return;
      }
      const dataset = await datasets.get(request.params.datasetId);
      if (dataset === null) {
        return reply.code(404).send({
          code: "DATASET_NOT_FOUND",
          message: "Dataset not found",
        } satisfies ApiErrorResponse);
      }
      return dataset;
    },
  );

  app.post<{ Body: DatasetCreateRequest }>(
    "/api/v1/datasets",
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
          await datasets.create(principal, request.body),
        );
      } catch (error) {
        return sendDatasetError(reply, error);
      }
    },
  );

  app.post<{
    Params: { datasetId: string };
    Body: DatasetRevisionCreateRequest;
  }>(
    "/api/v1/datasets/:datasetId/revisions",
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
          await datasets.createRevision(
            request.params.datasetId,
            principal,
            request.body,
          ),
        );
      } catch (error) {
        return sendDatasetError(reply, error);
      }
    },
  );
}

function sendDatasetError(
  reply: FastifyReply,
  error: unknown,
) {
  if (error instanceof DatasetValidationError) {
    return reply.code(400).send({
      code: "DATASET_INVALID",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  if (error instanceof DatasetTraceUnavailableError) {
    return reply.code(422).send({
      code: "DATASET_TRACE_UNAVAILABLE",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  if (error instanceof DatasetNotFoundError) {
    return reply.code(404).send({
      code: "DATASET_NOT_FOUND",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  if (error instanceof DatasetNameConflictError) {
    return reply.code(409).send({
      code: "DATASET_NAME_CONFLICT",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  if (error instanceof DatasetCaseConflictError) {
    return reply.code(409).send({
      code: "DATASET_CASE_CONFLICT",
      message: error.message,
    } satisfies ApiErrorResponse);
  }
  throw error;
}
