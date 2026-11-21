import type { ApiErrorResponse } from "@agent-ops/contracts";
import type { FastifyInstance } from "fastify";

import type { IngestRequestAuthorizer } from "../../application/dependencies.js";
import {
  InvalidOtlpBatchError,
  type OtlpIngestService,
} from "../../application/ingest.js";

export function registerOtlpIngestRoute(
  app: FastifyInstance,
  ingest: OtlpIngestService,
  authorizeIngest: IngestRequestAuthorizer,
): void {
  app.post<{ Body: Buffer }>("/v1/traces", async (request, reply) => {
    const apiKey = request.headers["x-api-key"];
    if (
      !authorizeIngest({
        authorization: request.headers.authorization,
        apiKey: typeof apiKey === "string" ? apiKey : apiKey?.[0],
      })
    ) {
      const error: ApiErrorResponse = {
        code: "INGEST_UNAUTHORIZED",
        message: "Invalid agent ingest credential",
      };
      return reply.code(401).send(error);
    }

    const payload = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(request.body ?? []);

    try {
      const result = await ingest.receive(payload);
      return reply
        .header("content-type", "application/x-protobuf")
        .send(Buffer.from(result.responseBody));
    } catch (error) {
      if (error instanceof InvalidOtlpBatchError) {
        const response: ApiErrorResponse = {
          code: "OTLP_INGEST_FAILED",
          message: "Invalid OTLP trace batch",
        };
        return reply.code(400).send(response);
      }

      request.log.error(error, "Failed to persist OTLP trace batch");
      const response: ApiErrorResponse = {
        code: "OTLP_INGEST_UNAVAILABLE",
        message: "Trace ingest is temporarily unavailable",
      };
      return reply.code(503).send(response);
    }
  });
}
