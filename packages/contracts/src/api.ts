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

export interface HealthResponse {
  status: "ok" | "degraded";
  schemaVersion: string;
  database: "connected" | "unavailable";
}

export interface ApiErrorResponse {
  code: string;
  message: string;
}
