import type {
  Environment,
  RunStatus,
  SpanType,
  TraceIngestState,
} from "./generated.js";

export interface TraceListQuery {
  search?: string;
  status?: string;
  environment?: string;
  limit?: number;
}

export interface TraceListItem {
  traceId: string;
  runName: string;
  sessionId: string | null;
  taskType: string | null;
  model: string | null;
  environment: Environment | null;
  runStatus: RunStatus | null;
  latencyMs: number | null;
  costMicros: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stepCount: number | null;
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
  promptVersion: string | null;
  stopReason: string | null;
  spans: TraceSpan[];
}

export interface TraceListResponse {
  items: TraceListItem[];
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
