import type {
  ContentRecorded,
  ContentStatus,
  Environment,
  RunStatus,
  SpanType,
  TraceIngestState,
} from "./generated.js";

export interface CanonicalSpanEvent {
  index: number;
  name: string;
  eventTimeUnixNano: string;
  attributes: Record<string, unknown>;
}

export interface CanonicalSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  spanType: SpanType;
  spanSubtype?: string;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  status: "UNSET" | "OK" | "ERROR";
  errorType?: string;
  errorCategory?: string;
  serviceName?: string;
  serviceVersion?: string;
  environment?: Environment;
  resourceAttributes: Record<string, unknown>;
  attributes: Record<string, unknown>;
  events: CanonicalSpanEvent[];
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  ttftMs?: number;
  costMicros?: number;
  priceVersionId?: string;
  contentRecorded: ContentRecorded;
  inputContentId?: string;
  outputContentId?: string;
  schemaVersion: string;
  receivedAt: string;
}

export interface ContentObject {
  contentId: string;
  objectKey: string;
  ownerApp: string;
  contentKind: string;
  mediaType: string;
  captureMode: ContentRecorded;
  sizeBytes: number;
  sha256: string;
  redactionRuleVersion: string;
  encryption: string;
  status: ContentStatus;
  createdAt: string;
  expiresAt?: string;
}

export interface ContentUploadRequest {
  ownerApp: string;
  contentKind: string;
  mediaType: string;
  captureMode: ContentRecorded;
  redactionRuleVersion: string;
  content: string;
}

export interface ContentUploadResponse {
  contentId: string;
  sizeBytes: number;
  sha256: string;
  status: ContentStatus;
}

export interface TraceProjection {
  traceId: string;
  sessionId?: string;
  rootSpanId?: string;
  appName?: string;
  serviceName?: string;
  serviceVersion?: string;
  environment?: Environment;
  taskType?: string;
  promptVersion?: string;
  model?: string;
  runStatus?: RunStatus;
  stopReason?: string;
  firstSpanAt: string;
  lastSpanAt: string;
  startTime?: string;
  endTime?: string;
  rootEndedAt?: string;
  durationMs?: number;
  stepCount?: number;
  llmCallCount?: number;
  toolCallCount?: number;
  toolErrorCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicros?: number;
  currency?: string;
  completeness?: string;
  ingestState: TraceIngestState;
  sealedAt?: string;
  aggregationRevision: number;
}

