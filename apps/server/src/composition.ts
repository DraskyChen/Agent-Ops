import type { Pool } from "pg";

import type { ServerDependencies } from "./application/dependencies.js";
import { createContentService } from "./application/content.js";
import { createOtlpIngestService } from "./application/ingest.js";
import { createTraceQueryService } from "./application/traces.js";
import { createIngestRequestAuthorizer } from "./http/ingest-auth.js";
import { createPostgresTraceBatchWriter } from "./infrastructure/postgres/ingest-writer.js";
import { createPostgresContentRepository } from "./infrastructure/postgres/content-repository.js";
import { createPostgresTraceReadRepository } from "./infrastructure/postgres/trace-repository.js";
import {
  createMinioContentStore,
  type MinioContentStoreConfig,
} from "./infrastructure/minio/content-store.js";
import { otlpCodec } from "./infrastructure/otlp/codec.js";

export interface CompositionOptions {
  pool: Pool;
  ingestToken?: string;
  content: MinioContentStoreConfig & {
    maxBytes: number;
    retentionDays: number;
  };
}

export function createServerDependencies(
  options: CompositionOptions,
): ServerDependencies {
  return {
    healthCheck: async () => {
      await options.pool.query("select 1");
    },
    traces: createTraceQueryService(
      createPostgresTraceReadRepository(options.pool),
    ),
    ingest: createOtlpIngestService(
      otlpCodec,
      createPostgresTraceBatchWriter(options.pool),
    ),
    content: createContentService(
      createMinioContentStore(options.content),
      createPostgresContentRepository(options.pool),
      {
        maxBytes: options.content.maxBytes,
        retentionDays: options.content.retentionDays,
      },
    ),
    authorizeIngest: createIngestRequestAuthorizer(options.ingestToken),
  };
}
