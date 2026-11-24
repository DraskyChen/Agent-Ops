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

export interface SessionStatusCounts {
  unknown: number;
  success: number;
  failed: number;
  partial: number;
  cancelled: number;
  timeout: number;
}

export interface SessionSummary {
  sessionId: string;
  traceCount: number;
  firstStartedAt: string | null;
  lastEndedAt: string | null;
  durationMs: number | null;
  totalCostMicros: number;
  inputTokens: number;
  outputTokens: number;
  toolErrorCount: number;
  statusCounts: SessionStatusCounts;
  appNames: string[];
}

export interface SessionDetail extends SessionSummary {
  runs: TraceListItem[];
}

export interface SessionListQuery {
  search?: string;
  startedAfter?: string;
  limit?: number;
}

export interface SessionListResponse {
  windowHours: number;
  generatedAt: string;
  items: SessionSummary[];
}

export type PromptRegistryStatus = "active" | "deprecated";

export interface PromptVersionSummary {
  promptVersion: string;
  name: string;
  owner: string | null;
  description: string | null;
  status: PromptRegistryStatus;
  traceCount: number;
  datasetCount: number;
  evaluationCount: number;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ObservedPromptVersion {
  promptVersion: string;
  traceCount: number;
  lastSeenAt: string | null;
}

export interface PromptRegistryResponse {
  entries: PromptVersionSummary[];
  observedUnregistered: ObservedPromptVersion[];
}

export interface PromptVersionCreateRequest {
  promptVersion: string;
  name?: string;
  owner?: string;
  description?: string;
  status?: PromptRegistryStatus;
}

export interface PromptVersionUpdateRequest {
  name?: string;
  owner?: string | null;
  description?: string | null;
  status?: PromptRegistryStatus;
}

export type PromptRegistryEventType = "created" | "updated";

export interface PromptRegistryEvent {
  eventId: string;
  promptVersion: string;
  eventType: PromptRegistryEventType;
  actor: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  createdAt: string;
}

export interface PromptVersionDetail {
  prompt: PromptVersionSummary;
  history: PromptRegistryEvent[];
}

export type CandidateReason =
  | "negative_feedback"
  | "review_open"
  | "runtime_failure"
  | "evaluation_failed"
  | "evaluation_blocked";

export interface TraceCandidate extends TraceListItem {
  reasons: CandidateReason[];
  feedbackTypes: FeedbackType[];
  reviewIssueArea: ReviewIssueArea | null;
  evaluationFailureCount: number;
  evaluationBlockedCount: number;
  datasetCount: number;
  datasetEligible: boolean;
  dismissedAt: string | null;
  dismissedBy: string | null;
}

export interface TraceCandidateCounts {
  active: number;
  negativeFeedback: number;
  reviewOpen: number;
  runtimeFailure: number;
  evaluationFailed: number;
  evaluationBlocked: number;
  dismissed: number;
}

export interface TraceCandidateListResponse {
  windowHours: number;
  generatedAt: string;
  counts: TraceCandidateCounts;
  items: TraceCandidate[];
}

export interface TraceCandidateDismissRequest {
  reason?: string;
}

export interface TraceCandidateActionResponse {
  traceId: string;
  dismissed: boolean;
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

export type DatasetRevisionChangeKind =
  | "case_metadata"
  | "input_content"
  | "baseline_output"
  | "expected_output"
  | "expected_behavior"
  | "tags";

export interface DatasetRevisionDiffItem {
  caseId: string;
  status: "added" | "removed" | "changed" | "unchanged";
  changes: DatasetRevisionChangeKind[];
  baseline: DatasetItem | null;
  candidate: DatasetItem | null;
}

export interface DatasetRevisionDiff {
  datasetId: string;
  baseline: DatasetRevisionSummary;
  candidate: DatasetRevisionSummary;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  unchangedCount: number;
  items: DatasetRevisionDiffItem[];
}

export interface DatasetCreateRequest {
  name: string;
  description?: string;
}

export interface DatasetItemDraft {
  traceId?: string;
  sourceRevisionItemId?: string;
  caseId?: string;
  expectedOutput?: string | null;
  expectedBehavior?: string | null;
  tags?: string[];
}

export interface DatasetRevisionCreateRequest {
  baseRevisionId?: string;
  note?: string;
  items: DatasetItemDraft[];
}

export type RuleEvaluatorDefinition =
  | {
      name: string;
      version: number;
      kind: "exact";
      config: { ignoreCase?: boolean };
    }
  | {
      name: string;
      version: number;
      kind: "contains";
      config: { value: string; ignoreCase?: boolean };
    }
  | {
      name: string;
      version: number;
      kind: "regex";
      config: { pattern: string; ignoreCase?: boolean };
    }
  | {
      name: string;
      version: number;
      kind: "json_valid";
      config: Record<string, never>;
    }
  | {
      name: string;
      version: number;
      kind: "max_latency_ms";
      config: { value: number };
    }
  | {
      name: string;
      version: number;
      kind: "max_cost_micros";
      config: { value: number };
    }
  | {
      name: string;
      version: number;
      kind: "max_tool_errors";
      config: { value: number };
    };

export interface LlmJudgeDefinition {
  name: string;
  version: number;
  kind: "llm_judge";
  config: {
    model: string;
    rubric: string;
    allowExternalContent: true;
    temperature?: number;
  };
}

export type EvaluatorDefinition =
  | RuleEvaluatorDefinition
  | LlmJudgeDefinition;

export interface EvaluationTraceSelector {
  appName?: string;
  promptVersion?: string;
  serviceVersion?: string;
  environment?: Environment;
  startedAfter?: string;
  startedBefore?: string;
}

export interface EvaluationCreateRequest {
  datasetRevisionId: string;
  evaluator: EvaluatorDefinition;
  traceSelector: EvaluationTraceSelector;
}

export interface EvaluatorTemplate {
  evaluatorId: string;
  evaluator: EvaluatorDefinition;
  createdBy: string;
  createdAt: string;
}

export interface EvaluatorTemplateCreateRequest {
  evaluator: EvaluatorDefinition;
}

export type EvaluationStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type EvaluationCaseStatus =
  | "pending"
  | "missing"
  | "unscorable"
  | "completed"
  | "failed";

export interface EvaluationSummary {
  evaluationId: string;
  datasetId: string;
  datasetName: string;
  datasetRevisionId: string;
  datasetRevision: number;
  evaluatorName: string;
  evaluatorVersion: number;
  evaluatorKind: EvaluatorDefinition["kind"];
  candidateAppName: string | null;
  candidatePromptVersion: string | null;
  status: EvaluationStatus;
  totalCases: number;
  scoredCases: number;
  passedCases: number;
  failedCases: number;
  missingCases: number;
  unscorableCases: number;
  erroredCases: number;
  averageScore: number | null;
  averageCostMicros: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  requestedBy: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

export interface EvaluationCaseResult {
  evaluationCaseId: string;
  datasetItemId: string;
  caseId: string;
  candidateTraceId: string | null;
  status: EvaluationCaseStatus;
  score: number | null;
  passed: boolean | null;
  reason: string | null;
  error: string | null;
  judgeCall: JudgeCallSummary | null;
  latencyMs: number | null;
  costMicros: number | null;
}

export interface JudgeCallSummary {
  status: "pending" | "completed" | "failed";
  provider: "deepseek";
  model: string;
  promptContentRef: string | null;
  responseContentRef: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costMicros: number | null;
}

export interface EvaluationDetail extends EvaluationSummary {
  evaluator: EvaluatorDefinition;
  traceSelector: EvaluationTraceSelector;
  cases: EvaluationCaseResult[];
}

export interface EvaluationComparisonCase {
  caseId: string;
  baseline: EvaluationCaseResult | null;
  candidate: EvaluationCaseResult | null;
  scoreDelta: number | null;
  latencyDeltaMs: number | null;
  costDeltaMicros: number | null;
}

export interface EvaluationComparison {
  baseline: EvaluationSummary;
  candidate: EvaluationSummary;
  pairedCases: number;
  baselineOnlyCases: number;
  candidateOnlyCases: number;
  cases: EvaluationComparisonCase[];
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
