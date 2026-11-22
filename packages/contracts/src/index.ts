import {
  ENUMS,
  SCHEMA_VERSION,
  TASK_TYPES,
  type ContentRecorded,
  type RunStatus,
  type SpanType,
  type TraceIngestState,
} from "./generated.js";

export * from "./generated.js";
export type {
  ApiErrorResponse,
  DatasetCreateRequest,
  DatasetDetail,
  DatasetItem,
  DatasetItemDraft,
  DatasetRevisionCreateRequest,
  DatasetRevisionDetail,
  DatasetRevisionSummary,
  DatasetSummary,
  EvaluationCaseResult,
  EvaluationCaseStatus,
  EvaluationCreateRequest,
  EvaluationDetail,
  EvaluationStatus,
  EvaluationSummary,
  EvaluationTraceSelector,
  EvaluatorDefinition,
  FeedbackItem,
  FeedbackWriteRequest,
  FeedbackWriteResponse,
  HealthResponse,
  HumanRole,
  IngestHealthResponse,
  MeResponse,
  MetricsBreakdownQuery,
  MetricsBreakdownResponse,
  MetricsBreakdownRow,
  MetricsDimension,
  MetricsGranularity,
  MetricsOverviewResponse,
  MetricsPoint,
  MetricsQuery,
  MetricsScope,
  MetricsStatusCounts,
  MetricsSummary,
  ReviewIssueArea,
  ReviewItem,
  ReviewState,
  ReviewStatus,
  ReviewWriteRequest,
  JudgeCallSummary,
  LlmJudgeDefinition,
  RuleEvaluatorDefinition,
  TraceDetail,
  TraceListItem,
  TraceListQuery,
  TraceListResponse,
  TraceSpan,
} from "./api.js";
export type {
  CanonicalSpan,
  CanonicalSpanEvent,
  ContentObject,
  ContentUploadRequest,
  ContentUploadResponse,
  TraceProjection,
} from "./models.js";

const SPAN_TYPE_SET = new Set<string>(ENUMS.spanType);
const RUN_STATUS_SET = new Set<string>(ENUMS.runStatus);
const TASK_TYPE_SET = new Set<string>(TASK_TYPES);
const CONTENT_RECORDED_SET = new Set<string>(ENUMS.contentRecorded);
const TRACE_INGEST_STATE_SET = new Set<string>(ENUMS.traceIngestState);

export function isSpanType(value: string): value is SpanType {
  return SPAN_TYPE_SET.has(value);
}

export function normalizeSpanType(value: string): SpanType | "custom" {
  return isSpanType(value) ? value : "custom";
}

export function isRunStatus(value: string): value is RunStatus {
  return RUN_STATUS_SET.has(value);
}

export function normalizeTaskType(value: string): string {
  return TASK_TYPE_SET.has(value) ? value : "other";
}

export function isContentRecorded(value: string): value is ContentRecorded {
  return CONTENT_RECORDED_SET.has(value);
}

export function isTraceIngestState(value: string): value is TraceIngestState {
  return TRACE_INGEST_STATE_SET.has(value);
}

export function assertSupportedSchemaVersion(version: string): void {
  const [supportedMajor] = SCHEMA_VERSION.split(".");
  const [actualMajor] = version.split(".");
  if (supportedMajor !== actualMajor) {
    throw new Error(
      `Unsupported Agent Ops schema major version ${version}; expected ${supportedMajor}.x`,
    );
  }
}

