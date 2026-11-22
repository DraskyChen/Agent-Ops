import type { OtlpIngestService } from "./ingest.js";
import type { HumanAuth } from "./auth.js";
import type { ContentService } from "./content.js";
import type { DatasetService } from "./datasets.js";
import type { EvaluationService } from "./evaluations.js";
import type { FeedbackService } from "./feedback.js";
import type { MetricsService } from "./metrics.js";
import type { OperationsService } from "./operations.js";
import type { ReviewService } from "./reviews.js";
import type { TraceQueryService } from "./traces.js";

export interface IngestRequestMetadata {
  authorization?: string;
  apiKey?: string;
}

export type IngestRequestAuthorizer = (
  request: IngestRequestMetadata,
) => boolean;

export interface ServerDependencies {
  healthCheck: () => Promise<void>;
  humanAuth: HumanAuth;
  traces: TraceQueryService;
  ingest: OtlpIngestService;
  content: ContentService;
  datasets: DatasetService;
  evaluations: EvaluationService;
  feedback: FeedbackService;
  metrics: MetricsService;
  reviews: ReviewService;
  operations: OperationsService;
  authorizeIngest: IngestRequestAuthorizer;
}
