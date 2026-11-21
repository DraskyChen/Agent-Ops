import type {
  IngestHealthResponse,
  MeResponse,
  ReviewItem,
  TraceDetail as ApiTraceDetail,
  TraceListItem,
  TraceListResponse,
  TraceSpan as ApiTraceSpan,
} from "@agent-ops/contracts";

import {
  getJson,
  getText,
  HttpError,
  postJson,
} from "../../shared/http.js";
import type {
  ReviewInput,
  SpanStatus,
  SpanType,
  TraceFilters,
  TraceSpanView,
  TraceStatus,
  TraceView,
} from "./model.js";

export interface TracePage {
  items: TraceView[];
  nextCursor: string | null;
}

export async function fetchTraces(
  filters: TraceFilters,
  cursor: string | null = null,
  startedAfter = new Date(
    Date.now() - rangeMilliseconds(filters.timeRange),
  ).toISOString(),
): Promise<TracePage> {
  const params = queryParameters(filters, startedAfter);
  if (cursor !== null) {
    params.set("cursor", cursor);
  }
  params.set("limit", "50");
  const body = await getJson<TraceListResponse>(
    `/api/v1/traces?${params.toString()}`,
  );
  return {
    items: body.items.map(toTraceView),
    nextCursor: body.nextCursor,
  };
}

export async function fetchTraceDetail(
  traceId: string,
  canViewContent: boolean,
): Promise<TraceView> {
  const body = await getJson<ApiTraceDetail>(
    `/api/v1/traces/${encodeURIComponent(traceId)}`,
  );
  const parentBySpanId = new Map(
    body.spans.map((span) => [span.spanId, span.parentSpanId]),
  );
  const hydratedSpans = await Promise.all(
    body.spans.map(async (span) => {
      const [inputContent, outputContent] = await Promise.all([
        fetchContent(span.inputContentRef, canViewContent),
        fetchContent(span.outputContentRef, canViewContent),
      ]);
      return toSpanView(
        span,
        parentBySpanId,
        inputContent,
        outputContent,
      );
    }),
  );
  return {
    ...toTraceView(body),
    spans: hydratedSpans,
    feedback: body.feedback,
    reviews: body.reviews,
  };
}

export async function fetchMe(): Promise<MeResponse> {
  return getJson<MeResponse>("/api/v1/me");
}

export async function fetchIngestHealth(
  windowHours: number,
): Promise<IngestHealthResponse> {
  return getJson<IngestHealthResponse>(
    `/api/v1/operations/ingest?windowHours=${windowHours}`,
  );
}

export async function submitTraceReview(
  traceId: string,
  input: ReviewInput,
): Promise<ReviewItem> {
  return postJson<ReviewItem, ReviewInput>(
    `/api/v1/traces/${encodeURIComponent(traceId)}/reviews`,
    input,
  );
}

function queryParameters(
  filters: TraceFilters,
  startedAfter: string,
): URLSearchParams {
  const params = new URLSearchParams();
  params.set("startedAfter", startedAfter);
  setText(params, "search", filters.search);
  setFilter(params, "status", filters.status);
  setFilter(params, "environment", filters.environment);
  setText(params, "appName", filters.appName);
  setText(params, "taskType", filters.taskType);
  setText(params, "model", filters.model);
  setText(params, "promptVersion", filters.promptVersion);
  setText(params, "serviceVersion", filters.serviceVersion);
  setFilter(params, "hasErrors", filters.hasErrors);
  setFilter(params, "reviewStatus", filters.reviewStatus);
  return params;
}

function setText(
  params: URLSearchParams,
  key: string,
  value: string,
): void {
  const normalized = value.trim();
  if (normalized !== "") {
    params.set(key, normalized);
  }
}

function setFilter(
  params: URLSearchParams,
  key: string,
  value: string,
): void {
  if (value !== "all") {
    params.set(key, value);
  }
}

function rangeMilliseconds(range: TraceFilters["timeRange"]): number {
  return range === "24h"
    ? 24 * 60 * 60 * 1000
    : range === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
}

function toTraceView(trace: TraceListItem): TraceView {
  return {
    id: trace.traceId,
    runName: trace.runName,
    sessionId: trace.sessionId ?? "unknown",
    appName: trace.appName ?? "unknown",
    serviceVersion: trace.serviceVersion ?? "unknown",
    taskType: trace.taskType ?? "other",
    model: trace.model ?? "unknown",
    promptVersion: trace.promptVersion ?? "unknown",
    environment: trace.environment ?? "unknown",
    status: normalizeTraceStatus(trace.runStatus),
    ingestState: trace.ingestState,
    latencyMs: trace.latencyMs ?? 0,
    costMicros: trace.costMicros ?? 0,
    inputTokens: trace.inputTokens ?? 0,
    outputTokens: trace.outputTokens ?? 0,
    stepCount: trace.stepCount ?? 0,
    toolErrorCount: trace.toolErrorCount ?? 0,
    reviewStatus: trace.reviewStatus,
    startedAt: trace.startedAt ?? new Date(0).toISOString(),
    spans: [],
    feedback: [],
    reviews: [],
  };
}

function toSpanView(
  span: ApiTraceSpan,
  parentBySpanId: ReadonlyMap<string, string | null>,
  inputContent: string | undefined,
  outputContent: string | undefined,
): TraceSpanView {
  const attributesText = JSON.stringify(span.attributes, null, 2);
  const spanType = normalizeSpanType(span.spanType);
  return {
    id: span.spanId,
    name: span.name,
    type: spanType,
    status: normalizeSpanStatus(span.status),
    depth: spanDepth(span, parentBySpanId),
    latencyMs: span.durationMs,
    ...(span.inputTokens === null ? {} : { inputTokens: span.inputTokens }),
    ...(span.outputTokens === null ? {} : { outputTokens: span.outputTokens }),
    ...(span.costMicros === null ? {} : { costMicros: span.costMicros }),
    input:
      inputContent ??
      stringAttribute(span.attributes, "agent.input.summary") ??
      (spanType === "tool"
        ? stringAttribute(span.attributes, "agent.tool.args.summary")
        : undefined) ??
      attributesText,
    output:
      outputContent ??
      stringAttribute(span.attributes, "agent.output.summary") ??
      stringAttribute(span.attributes, "agent.error.message") ??
      (span.outputContentRef === null
        ? "No output summary captured."
        : `Content reference: ${span.outputContentRef}`),
    metadata: Object.fromEntries(
      Object.entries(span.attributes).map(([key, value]) => [
        key,
        typeof value === "string" ? value : JSON.stringify(value),
      ]),
    ),
  };
}

async function fetchContent(
  contentId: string | null,
  canViewContent: boolean,
): Promise<string | undefined> {
  if (contentId === null) {
    return undefined;
  }
  if (!canViewContent) {
    return "Content viewing requires reviewer permission.";
  }
  try {
    return await getText(`/api/v1/content/${encodeURIComponent(contentId)}`);
  } catch (error) {
    if (error instanceof HttpError && error.status === 410) {
      return "Content expired under the configured retention policy.";
    }
    if (error instanceof HttpError && error.status === 403) {
      return "Content viewing requires reviewer permission.";
    }
    return "Content is unavailable.";
  }
}

function spanDepth(
  span: ApiTraceSpan,
  parentBySpanId: ReadonlyMap<string, string | null>,
): number {
  let depth = 0;
  let parentId = span.parentSpanId;
  const visited = new Set<string>();
  while (parentId !== null && depth < 32 && !visited.has(parentId)) {
    visited.add(parentId);
    const nextParentId = parentBySpanId.get(parentId);
    if (nextParentId === undefined) {
      break;
    }
    depth += 1;
    parentId = nextParentId;
  }
  return depth;
}

function normalizeTraceStatus(
  status: TraceListItem["runStatus"],
): TraceStatus {
  switch (status) {
    case "success":
    case "failed":
    case "partial":
    case "cancelled":
    case "timeout":
      return status;
    default:
      return "partial";
  }
}

function normalizeSpanType(type: ApiTraceSpan["spanType"]): SpanType {
  switch (type) {
    case "llm.call":
      return "llm";
    case "tool.call":
      return "tool";
    case "retrieval":
      return "retrieval";
    default:
      return "agent";
  }
}

function normalizeSpanStatus(status: ApiTraceSpan["status"]): SpanStatus {
  switch (status) {
    case "ERROR":
      return "error";
    case "UNSET":
      return "partial";
    default:
      return "ok";
  }
}

function stringAttribute(
  attributes: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = attributes[key];
  return typeof value === "string" ? value : undefined;
}
