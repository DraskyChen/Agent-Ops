export interface StoredTraceSpan {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  service_name: string | null;
  service_version: string | null;
  environment: string | null;
  span_type: string;
  name: string;
  start_time: Date;
  end_time: Date;
  duration_ms: string;
  status: string;
  resource_attributes: Record<string, unknown>;
  attributes: Record<string, unknown>;
  input_tokens: string | null;
  output_tokens: string | null;
  cached_input_tokens: string | null;
  cost_micros: string | null;
}

export interface AggregatedTrace {
  traceId: string;
  sessionId: string | null;
  rootSpanId: string | null;
  appName: string | null;
  runName: string;
  serviceName: string | null;
  serviceVersion: string | null;
  environment: string | null;
  taskType: string | null;
  promptVersion: string | null;
  model: string | null;
  runStatus: string | null;
  stopReason: string | null;
  firstSpanAt: Date;
  lastSpanAt: Date;
  startTime: Date;
  endTime: Date;
  rootEndedAt: Date | null;
  durationMs: number;
  stepCount: number;
  llmCallCount: number;
  toolCallCount: number;
  toolErrorCount: number;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  completeness: "complete" | "incomplete";
  ingestState: "sealed_complete" | "sealed_partial";
}

export function aggregateTraceSpans(
  traceId: string,
  spans: StoredTraceSpan[],
): AggregatedTrace {
  const root =
    spans.find((span) => span.span_type === "agent.run") ?? undefined;
  const llmSpans = spans.filter((span) => span.span_type === "llm.call");
  const toolSpans = spans.filter((span) => span.span_type === "tool.call");
  const firstSpan = spans[0];
  const lastSpan = spans[spans.length - 1];
  const fallback = root ?? firstSpan;
  if (firstSpan === undefined || lastSpan === undefined || fallback === undefined) {
    throw new Error(`Trace ${traceId} has no usable spans`);
  }

  const rootAttributes = root?.attributes ?? {};
  const firstLlm = llmSpans[0];
  const runStatus =
    stringValue(rootAttributes["agent.run.status"]) ??
    (root?.status === "ERROR" ? "failed" : null);
  const model =
    firstLlm === undefined
      ? null
      : stringValue(firstLlm.attributes["gen_ai.request.model"]) ?? null;
  const promptVersion =
    stringValue(rootAttributes["agent.prompt.version"]) ??
    (firstLlm === undefined
      ? null
      : stringValue(firstLlm.attributes["agent.prompt.version"]) ?? null);

  return {
    traceId,
    sessionId: stringValue(rootAttributes["agent.session.id"]) ?? null,
    rootSpanId: root?.span_id ?? null,
    appName:
      stringValue(fallback.resource_attributes["agent.app.name"]) ?? null,
    runName: root?.name ?? fallback.name,
    serviceName: root?.service_name ?? fallback.service_name,
    serviceVersion: root?.service_version ?? fallback.service_version,
    environment: root?.environment ?? fallback.environment,
    taskType: stringValue(rootAttributes["agent.task.type"]),
    promptVersion,
    model,
    runStatus,
    stopReason: stringValue(rootAttributes["agent.run.stop_reason"]),
    firstSpanAt: firstSpan.start_time,
    lastSpanAt: lastSpan.end_time,
    startTime: firstSpan.start_time,
    endTime: lastSpan.end_time,
    rootEndedAt: root?.end_time ?? null,
    durationMs: lastSpan.end_time.getTime() - firstSpan.start_time.getTime(),
    stepCount: llmSpans.length + toolSpans.length,
    llmCallCount: llmSpans.length,
    toolCallCount: toolSpans.length,
    toolErrorCount: toolSpans.filter((span) => span.status === "ERROR").length,
    inputTokens: sumNumeric(spans, "input_tokens"),
    outputTokens: sumNumeric(spans, "output_tokens"),
    costMicros: sumNumeric(spans, "cost_micros"),
    completeness: root === undefined ? "incomplete" : "complete",
    ingestState: root === undefined ? "sealed_partial" : "sealed_complete",
  };
}

function sumNumeric(
  spans: StoredTraceSpan[],
  field: "input_tokens" | "output_tokens" | "cost_micros",
): number {
  return spans.reduce(
    (total, span) => total + (span[field] === null ? 0 : Number(span[field])),
    0,
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
