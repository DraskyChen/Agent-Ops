import type {
  FeedbackItem,
  ReviewIssueArea,
  ReviewItem,
  ReviewState,
  ReviewStatus,
} from "@agent-ops/contracts";

export type TraceStatus =
  | "success"
  | "failed"
  | "partial"
  | "cancelled"
  | "timeout";
export type SpanType = "agent" | "llm" | "tool" | "retrieval";
export type SpanStatus = "ok" | "error" | "partial";
export type InspectorTab = "input" | "output" | "metadata";
export type TimeRange = "24h" | "7d" | "30d" | "custom";

export interface TraceFilters {
  search: string;
  status: TraceStatus | "all";
  environment: string;
  timeRange: TimeRange;
  startedAfter?: string;
  startedBefore?: string;
  appName: string;
  taskType: string;
  model: string;
  promptVersion: string;
  serviceVersion: string;
  hasErrors: "all" | "true" | "false";
  reviewStatus: ReviewState | "all";
}

export interface TraceSpanView {
  id: string;
  name: string;
  type: SpanType;
  status: SpanStatus;
  depth: number;
  startTime: string;
  endTime: string;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicros?: number;
  input: string;
  output: string;
  inputDownloadable: boolean;
  outputDownloadable: boolean;
  metadata: Record<string, string>;
}

export interface TraceView {
  id: string;
  runName: string;
  sessionId: string;
  appName: string;
  serviceVersion: string;
  taskType: string;
  model: string;
  promptVersion: string;
  evalCaseId: string | null;
  environment: string;
  status: TraceStatus;
  ingestState: string;
  latencyMs: number;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  stepCount: number;
  toolErrorCount: number;
  reviewStatus: ReviewState;
  startedAt: string;
  spans: TraceSpanView[];
  feedback: FeedbackItem[];
  reviews: ReviewItem[];
}

export interface ReviewInput {
  status: ReviewStatus;
  issueArea?: ReviewIssueArea;
  comment?: string;
}

export const DEFAULT_FILTERS: TraceFilters = {
  search: "",
  status: "all",
  environment: "all",
  timeRange: "24h",
  appName: "",
  taskType: "",
  model: "",
  promptVersion: "",
  serviceVersion: "",
  hasErrors: "all",
  reviewStatus: "all",
};
