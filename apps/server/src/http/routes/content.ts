import type {
  ApiErrorResponse,
  ContentUploadRequest,
  ContentUploadResponse,
} from "@agent-ops/contracts";
import type { FastifyInstance } from "fastify";

import {
  contentFileExtension,
  ContentTooLargeError,
  InvalidContentError,
  type ContentService,
} from "../../application/content.js";
import type { IngestRequestAuthorizer } from "../../application/dependencies.js";

export function registerContentRoutes(
  app: FastifyInstance,
  content: ContentService,
  authorizeIngest: IngestRequestAuthorizer,
): void {
  app.post<{ Body: ContentUploadRequest }>(
    "/api/v1/content",
    async (request, reply) => {
      const apiKey = request.headers["x-api-key"];
      if (
        !authorizeIngest({
          authorization: request.headers.authorization,
          apiKey: typeof apiKey === "string" ? apiKey : apiKey?.[0],
        })
      ) {
        const error: ApiErrorResponse = {
          code: "CONTENT_UNAUTHORIZED",
          message: "Invalid content upload credential",
        };
        return reply.code(401).send(error);
      }

      try {
        const record = await content.upload({
          ownerApp: request.body.ownerApp,
          contentKind: request.body.contentKind,
          mediaType: request.body.mediaType,
          captureMode: request.body.captureMode,
          redactionRuleVersion: request.body.redactionRuleVersion,
          body: Buffer.from(request.body.content, "utf8"),
        });
        const response: ContentUploadResponse = {
          contentId: record.contentId,
          sizeBytes: record.sizeBytes,
          sha256: record.sha256,
          status: record.status,
        };
        return reply.code(201).send(response);
      } catch (error) {
        if (error instanceof ContentTooLargeError) {
          return reply.code(413).send({
            code: "CONTENT_TOO_LARGE",
            message: error.message,
          } satisfies ApiErrorResponse);
        }
        if (error instanceof InvalidContentError) {
          return reply.code(400).send({
            code: "CONTENT_INVALID",
            message: error.message,
          } satisfies ApiErrorResponse);
        }
        request.log.error(error, "Failed to store content");
        return reply.code(503).send({
          code: "CONTENT_UNAVAILABLE",
          message: "Content storage is temporarily unavailable",
        } satisfies ApiErrorResponse);
      }
    },
  );

  app.get<{ Params: { contentId: string } }>(
    "/api/v1/content/:contentId",
    async (request, reply) => {
      const stored = await content.get(request.params.contentId);
      if (stored === null) {
        return reply.code(404).send({
          code: "CONTENT_NOT_FOUND",
          message: "Content not found",
        } satisfies ApiErrorResponse);
      }
      return reply
        .type(stored.metadata.mediaType)
        .header(
          "content-disposition",
          `inline; filename="${stored.metadata.contentId}.${contentFileExtension(stored.metadata.mediaType)}"`,
        )
        .header("cache-control", "private, max-age=60")
        .send(stored.body);
    },
  );
}

