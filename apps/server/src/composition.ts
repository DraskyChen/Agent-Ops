import type { Pool } from "pg";

import type { ServerDependencies } from "./application/dependencies.js";
import { createContentService } from "./application/content.js";
import { createCandidateService } from "./application/candidates.js";
import { createDatasetService } from "./application/datasets.js";
import { createEvaluationService } from "./application/evaluations.js";
import { createFeedbackService } from "./application/feedback.js";
import { createOtlpIngestService } from "./application/ingest.js";
import { createMetricsService } from "./application/metrics.js";
import { createOperationsService } from "./application/operations.js";
import { createPromptRegistryService } from "./application/prompt-registry.js";
import { createReviewService } from "./application/reviews.js";
import { createTraceQueryService } from "./application/traces.js";
import type { ServerConfig } from "./config.js";
import { createIngestRequestAuthorizer } from "./http/ingest-auth.js";
import { createDevHumanAuth } from "./infrastructure/auth/dev-auth.js";
import { createOidcHumanAuth } from "./infrastructure/auth/oidc-auth.js";
import { createPostgresHumanAuthRepository } from "./infrastructure/postgres/auth-repository.js";
import { createPostgresTraceBatchWriter } from "./infrastructure/postgres/ingest-writer.js";
import { createPostgresContentRepository } from "./infrastructure/postgres/content-repository.js";
import { createPostgresCandidateRepository } from "./infrastructure/postgres/candidate-repository.js";
import { createPostgresDatasetRepository } from "./infrastructure/postgres/dataset-repository.js";
import { createPostgresEvaluationRepository } from "./infrastructure/postgres/evaluation-repository.js";
import { createPostgresFeedbackRepository } from "./infrastructure/postgres/feedback-repository.js";
import { createPostgresMetricsRepository } from "./infrastructure/postgres/metrics-repository.js";
import { createPostgresOperationsRepository } from "./infrastructure/postgres/operations-repository.js";
import { createPostgresPromptRegistryRepository } from "./infrastructure/postgres/prompt-registry-repository.js";
import { createPostgresReviewRepository } from "./infrastructure/postgres/review-repository.js";
import { createPostgresTraceReadRepository } from "./infrastructure/postgres/trace-repository.js";
import {
  createMinioContentStore,
  type MinioContentStoreConfig,
} from "./infrastructure/minio/content-store.js";
import { otlpCodec } from "./infrastructure/otlp/codec.js";

export interface CompositionOptions {
  pool: Pool;
  ingestToken?: string;
  traceMaxLatenessHours: number;
  evaluationJudgeEnabled: boolean;
  auth: ServerConfig["auth"];
  content: MinioContentStoreConfig & {
    maxBytes: number;
    retentionDays: number;
    datasetRetentionDays: number;
  };
}

export async function createServerDependencies(
  options: CompositionOptions,
): Promise<ServerDependencies> {
  const humanAuth =
    options.auth.mode === "dev"
      ? createDevHumanAuth(options.auth.dev)
      : await createOidcHumanAuth(
          createPostgresHumanAuthRepository(options.pool),
          {
            config: options.auth.oidc,
            sessionTtlHours: options.auth.sessionTtlHours,
          },
        );
  const content = createContentService(
    createMinioContentStore(options.content),
    createPostgresContentRepository(options.pool),
    {
      maxBytes: options.content.maxBytes,
      retentionDays: options.content.retentionDays,
    },
  );

  return {
    healthCheck: async () => {
      await options.pool.query("select 1");
    },
    humanAuth,
    traces: createTraceQueryService(
      createPostgresTraceReadRepository(options.pool),
    ),
    ingest: createOtlpIngestService(
      otlpCodec,
      createPostgresTraceBatchWriter(options.pool, {
        maxLatenessHours: options.traceMaxLatenessHours,
      }),
    ),
    content,
    candidates: createCandidateService(
      createPostgresCandidateRepository(options.pool),
    ),
    datasets: createDatasetService(
      createPostgresDatasetRepository(options.pool),
      content,
      {
        contentRetentionDays: options.content.datasetRetentionDays,
      },
    ),
    evaluations: createEvaluationService(
      createPostgresEvaluationRepository(options.pool),
      { judgeEnabled: options.evaluationJudgeEnabled },
    ),
    feedback: createFeedbackService(
      createPostgresFeedbackRepository(options.pool),
    ),
    metrics: createMetricsService(
      createPostgresMetricsRepository(options.pool),
    ),
    reviews: createReviewService(createPostgresReviewRepository(options.pool)),
    operations: createOperationsService(
      createPostgresOperationsRepository(options.pool),
    ),
    prompts: createPromptRegistryService(
      createPostgresPromptRegistryRepository(options.pool),
    ),
    authorizeIngest: createIngestRequestAuthorizer(options.ingestToken),
  };
}
