import type {
  TraceDetail as ApiTraceDetail,
  TraceListItem,
  TraceListResponse,
  TraceSpan as ApiTraceSpan,
} from "@agent-ops/contracts";

import { getJson, getText } from "../../shared/http.js";
import type {
  SpanStatus,
  SpanType,
  TraceSpanView,
  TraceStatus,
  TraceView,
} from "./model.js";

export async function fetchTraces(): Promise<TraceView[]> {
  const body = await getJson<TraceListResponse>("/api/v1/traces?limit=100");
  return body.items.map(toTraceView);
}

export async function fetchTraceDetail(traceId: string): Promise<TraceView> {
  const body = await getJson<ApiTraceDetail>(
    `/api/v1/traces/${encodeURIComponent(traceId)}`,
  );
  const parentBySpanId = new Map(
    body.spans.map((span) => [span.spanId, span.parentSpanId]),
  );
  const hydratedSpans = await Promise.all(
    body.spans.map(async (span) => {
      const [inputContent, outputContent] = await Promise.all([
        fetchContent(span.inputContentRef),
        fetchContent(span.outputContentRef),
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
  };
}

function toTraceView(trace: TraceListItem): TraceView {
  return {
    id: trace.traceId,
    runName: trace.runName,
    sessionId: trace.sessionId ?? "unknown",
    taskType: trace.taskType ?? "other",
    model: trace.model ?? "unknown",
    environment: trace.environment ?? "unknown",
    status: normalizeTraceStatus(trace.runStatus),
    latencyMs: trace.latencyMs ?? 0,
    costMicros: trace.costMicros ?? 0,
    inputTokens: trace.inputTokens ?? 0,
    outputTokens: trace.outputTokens ?? 0,
    stepCount: trace.stepCount ?? 0,
    startedAt: trace.startedAt ?? new Date(0).toISOString(),
    spans: [],
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
): Promise<string | undefined> {
  if (contentId === null) {
    return undefined;
  }
  try {
    return await getText(
      `/api/v1/content/${encodeURIComponent(contentId)}`,
    );
  } catch {
    return undefined;
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
