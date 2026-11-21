import type {
  ApiErrorResponse,
  ContentUploadRequest,
  ContentUploadResponse,
} from "@agent-ops/contracts";
import type { FastifyInstance } from "fastify";

import {
  contentFileExtension,
  ContentExpiredError,
  ContentNotFoundError,
  ContentStorageError,
  ContentTooLargeError,
  InvalidContentError,
  type ContentService,
} from "../../application/content.js";
import {
  canViewContent,
  type HumanAuth,
} from "../../application/auth.js";
import type { IngestRequestAuthorizer } from "../../application/dependencies.js";
import { HUMAN_SESSION_COOKIE } from "../auth-context.js";

export function registerContentRoutes(
  app: FastifyInstance,
  content: ContentService,
  authorizeIngest: IngestRequestAuthorizer,
  humanAuth: HumanAuth,
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
      const principal = await humanAuth.authenticate(
        request.cookies[HUMAN_SESSION_COOKIE],
      );
      if (principal === null) {
        await content.auditDenied(request.params.contentId, null);
        return reply.code(401).send({
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication required",
        } satisfies ApiErrorResponse);
      }
      if (!canViewContent(principal.role)) {
        await content.auditDenied(
          request.params.contentId,
          principal.subject,
        );
        return reply.code(403).send({
          code: "PERMISSION_DENIED",
          message: "Content viewing permission required",
        } satisfies ApiErrorResponse);
      }
      if (!UUID_PATTERN.test(request.params.contentId)) {
        return reply.code(404).send({
          code: "CONTENT_NOT_FOUND",
          message: "Content not found",
        } satisfies ApiErrorResponse);
      }

      try {
        const stored = await content.get(
          request.params.contentId,
          principal.subject,
        );
        return reply
          .type(stored.metadata.mediaType)
          .header(
            "content-disposition",
            `inline; filename="${stored.metadata.contentId}.${contentFileExtension(stored.metadata.mediaType)}"`,
          )
          .header("cache-control", "private, no-store")
          .send(stored.body);
      } catch (error) {
        if (error instanceof ContentExpiredError) {
          return reply.code(410).send({
            code: "CONTENT_EXPIRED",
            message: error.message,
          } satisfies ApiErrorResponse);
        }
        if (error instanceof ContentNotFoundError) {
          return reply.code(404).send({
            code: "CONTENT_NOT_FOUND",
            message: error.message,
          } satisfies ApiErrorResponse);
        }
        if (error instanceof ContentStorageError) {
          return reply.code(503).send({
            code: "CONTENT_UNAVAILABLE",
            message: error.message,
          } satisfies ApiErrorResponse);
        }
        throw error;
      }
    },
  );
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

