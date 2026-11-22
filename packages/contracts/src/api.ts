import type {
  Environment,
  FeedbackType,
  RunStatus,
  SpanType,
  TraceIngestState,
} from "./generated.js";

export type HumanRole = "viewer" | "reviewer" | "admin";
export type ReviewStatus = "open" | "resolved" | "ignored";
export type ReviewState = "unreviewed" | ReviewStatus;
export type ReviewIssueArea =
  | "prompt"
  | "model"
  | "tool"
  | "retrieval"
  | "data"
  | "infrastructure"
  | "other";

export interface TraceListQuery {
  search?: string;
  status?: string;
  environment?: string;
  startedAfter?: string;
  startedBefore?: string;
  appName?: string;
  taskType?: string;
  model?: string;
  promptVersion?: string;
  evalCaseId?: string;
  serviceVersion?: string;
  hasErrors?: "true" | "false";
  reviewStatus?: string;
  cursor?: string;
  limit?: number;
}

export interface TraceListItem {
  traceId: string;
  runName: string;
  sessionId: string | null;
  appName: string | null;
  serviceVersion: string | null;
  taskType: string | null;
  model: string | null;
  promptVersion: string | null;
  evalCaseId: string | null;
  environment: Environment | null;
  runStatus: RunStatus | null;
  latencyMs: number | null;
  costMicros: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stepCount: number | null;
  toolErrorCount: number | null;
  reviewStatus: ReviewState;
  startedAt: string | null;
  ingestState: TraceIngestState;
}

export interface TraceSpan {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  spanType: SpanType;
  spanSubtype: string | null;
  serviceName: string | null;
  startTime: string;
  endTime: string;
  durationMs: number;
  status: "UNSET" | "OK" | "ERROR";
  errorType: string | null;
  errorCategory: string | null;
  attributes: Record<string, unknown>;
  resourceAttributes: Record<string, unknown>;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
  inputContentRef: string | null;
  outputContentRef: string | null;
}

export interface TraceDetail extends TraceListItem {
  stopReason: string | null;
  spans: TraceSpan[];
  feedback: FeedbackItem[];
  reviews: ReviewItem[];
}

export interface TraceListResponse {
  items: TraceListItem[];
  nextCursor: string | null;
}

export interface FeedbackItem {
  feedbackId: string;
  traceId: string;
  spanId: string | null;
  eventId: string;
  type: FeedbackType;
  actorRef: string | null;
  comment: string | null;
  createdAt: string;
}

export interface FeedbackWriteRequest {
  traceId: string;
  spanId?: string;
  eventId: string;
  type: FeedbackType;
  actorRef?: string;
  comment?: string;
}

export interface FeedbackWriteResponse {
  feedback: FeedbackItem;
  created: boolean;
}

export interface ReviewItem {
  reviewId: string;
  traceId: string;
  reviewerSubject: string;
  reviewerName: string;
  status: ReviewStatus;
  issueArea: ReviewIssueArea | null;
  comment: string | null;
  createdAt: string;
}

export interface ReviewWriteRequest {
  status: ReviewStatus;
  issueArea?: ReviewIssueArea;
  comment?: string;
}

export interface MeResponse {
  subject: string;
  displayName: string;
  email: string | null;
  role: HumanRole;
  canViewContent: boolean;
  canReview: boolean;
}

export interface IngestHealthResponse {
  windowHours: number;
  generatedAt: string;
  batches: {
    total: number;
    accepted: number;
    partial: number;
    failed: number;
    acceptedSpans: number;
    rejectedSpans: number;
  };
  rejectsByReason: Array<{
    reason: string;
    count: number;
  }>;
  aggregation: {
    pending: number;
    processing: number;
    failed: number;
    oldestPendingAt: string | null;
  };
  content: {
    available: number;
    unavailable: number;
    expired: number;
  };
}

export type MetricsGranularity = "hour" | "six_hour" | "day";
export type MetricsDimension =
  | "app"
  | "model"
  | "taskType"
  | "promptVersion"
  | "serviceVersion";

export interface MetricsQuery {
  startedAfter?: string;
  startedBefore?: string;
  environment?: string;
  appName?: string;
  taskType?: string;
  model?: string;
  promptVersion?: string;
  serviceVersion?: string;
}

export interface MetricsStatusCounts {
  unknown: number;
  success: number;
  failed: number;
  partial: number;
  cancelled: number;
  timeout: number;
}

export interface MetricsSummary {
  traceCount: number;
  finalizedTraceCount: number;
  statusCounts: MetricsStatusCounts;
  successRate: number | null;
  failureRate: number | null;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  toolErrorRate: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  estimatedPercentiles: true;
}

export interface MetricsPoint extends MetricsSummary {
  bucketStart: string;
  bucketEnd: string;
}

export interface MetricsScope {
  startedAfter: string;
  startedBefore: string;
  granularity: MetricsGranularity;
  generatedAt: string;
  dataThrough: string | null;
}

export interface MetricsOverviewResponse {
  scope: MetricsScope;
  summary: MetricsSummary;
  series: MetricsPoint[];
}

export interface MetricsBreakdownQuery extends MetricsQuery {
  dimension?: MetricsDimension;
  limit?: number;
}

export interface MetricsBreakdownRow {
  value: string;
  traceCount: number;
  costMicros: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  toolErrorRate: number | null;
  traceShare: number;
}

export interface MetricsBreakdownResponse {
  scope: MetricsScope;
  dimension: MetricsDimension;
  items: MetricsBreakdownRow[];
}

export interface DatasetSummary {
  datasetId: string;
  name: string;
  description: string | null;
  latestRevision: number | null;
  itemCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetRevisionSummary {
  revisionId: string;
  datasetId: string;
  revision: number;
  itemCount: number;
  note: string | null;
  createdBy: string;
  createdAt: string;
}

export interface DatasetItem {
  itemId: string;
  caseId: string;
  sourceTraceId: string;
  appName: string | null;
  promptVersion: string | null;
  taskType: string | null;
  model: string | null;
  environment: Environment | null;
  runStatus: RunStatus | null;
  sourceStartedAt: string | null;
  inputContentRef: string;
  baselineOutputContentRef: string;
  expectedOutputContentRef: string | null;
  expectedBehavior: string | null;
  tags: string[];
}

export interface DatasetDetail extends DatasetSummary {
  revisions: DatasetRevisionSummary[];
}

export interface DatasetRevisionDetail extends DatasetRevisionSummary {
  items: DatasetItem[];
}

export interface DatasetCreateRequest {
  name: string;
  description?: string;
}

export interface DatasetItemDraft {
  traceId: string;
  caseId?: string;
  expectedOutput?: string;
  expectedBehavior?: string;
  tags?: string[];
}

export interface DatasetRevisionCreateRequest {
  note?: string;
  items: DatasetItemDraft[];
}

export interface HealthResponse {
  status: "ok" | "degraded";
  schemaVersion: string;
  database: "connected" | "unavailable";
}

export interface ApiErrorResponse {
  code: string;
  message: string;
}
