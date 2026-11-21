import { describe, expect, it } from "vitest";

import type { StoredTraceSpan } from "../src/domain/trace-aggregation.js";
import { aggregateTraceSpans } from "../src/domain/trace-aggregation.js";

describe("trace aggregation", () => {
  it("derives the trace projection from immutable span facts", () => {
    const trace = aggregateTraceSpans(
      "trace-1",
      [
        span({
          span_id: "root",
          span_type: "agent.run",
          name: "support-agent",
          status: "OK",
          end_time: new Date("2026-11-21T00:00:03.000Z"),
          attributes: {
            "agent.run.status": "success",
            "agent.task.type": "support",
            "agent.session.id": "session-1",
          },
        }),
        span({
          span_id: "llm",
          span_type: "llm.call",
          name: "chat",
          start_time: new Date("2026-11-21T00:00:01.000Z"),
          end_time: new Date("2026-11-21T00:00:02.000Z"),
          attributes: { "gen_ai.request.model": "test-model" },
          input_tokens: "120",
          output_tokens: "30",
          cost_micros: "400",
        }),
        span({
          span_id: "tool",
          span_type: "tool.call",
          name: "lookup",
          status: "ERROR",
          start_time: new Date("2026-11-21T00:00:02.000Z"),
          end_time: new Date("2026-11-21T00:00:03.000Z"),
          input_tokens: "10",
          cost_micros: "50",
        }),
      ],
      clock("2026-11-21T00:02:03.000Z"),
    );

    expect(trace).toMatchObject({
      traceId: "trace-1",
      sessionId: "session-1",
      rootSpanId: "root",
      runName: "support-agent",
      model: "test-model",
      runStatus: "success",
      stepCount: 2,
      llmCallCount: 1,
      toolCallCount: 1,
      toolErrorCount: 1,
      inputTokens: 130,
      outputTokens: 30,
      costMicros: 450,
      ingestState: "sealed_complete",
    });
  });

  it("keeps an orphaned trace queryable as partial", () => {
    const trace = aggregateTraceSpans(
      "trace-2",
      [
        span({
          span_id: "llm",
          span_type: "llm.call",
          name: "chat",
        }),
      ],
      clock("2026-11-21T00:15:01.000Z"),
    );

    expect(trace.rootSpanId).toBeNull();
    expect(trace.completeness).toBe("incomplete");
    expect(trace.ingestState).toBe("sealed_partial");
  });

  it("keeps a completed root open until the seal grace period elapses", () => {
    const trace = aggregateTraceSpans(
      "trace-3",
      [
        span({
          span_id: "root",
          span_type: "agent.run",
          end_time: new Date("2026-11-21T00:00:03.000Z"),
        }),
      ],
      clock("2026-11-21T00:02:02.999Z"),
    );

    expect(trace.ingestState).toBe("open");
    expect(trace.sealAfter?.toISOString()).toBe(
      "2026-11-21T00:02:03.000Z",
    );
    expect(trace.sealedAt).toBeNull();
  });

  it("seals a root exactly when the grace boundary is reached", () => {
    const trace = aggregateTraceSpans(
      "trace-4",
      [
        span({
          span_id: "root",
          span_type: "agent.run",
          end_time: new Date("2026-11-21T00:00:03.000Z"),
        }),
      ],
      clock("2026-11-21T00:02:03.000Z"),
    );

    expect(trace.ingestState).toBe("sealed_complete");
    expect(trace.sealedAt?.toISOString()).toBe(
      "2026-11-21T00:02:03.000Z",
    );
  });
});

function clock(now: string) {
  return {
    now: new Date(now),
    rootSealGraceMs: 120_000,
    idleTimeoutMs: 15 * 60_000,
  };
}

function span(
  overrides: Partial<StoredTraceSpan> & Pick<StoredTraceSpan, "span_id" | "span_type">,
): StoredTraceSpan {
  return {
    trace_id: "trace-1",
    span_id: overrides.span_id,
    parent_span_id: null,
    service_name: "test-service",
    service_version: "1.0.0",
    environment: "test",
    span_type: overrides.span_type,
    name: "span",
    start_time: new Date("2026-11-21T00:00:00.000Z"),
    end_time: new Date("2026-11-21T00:00:01.000Z"),
    duration_ms: "1000",
    status: "OK",
    resource_attributes: { "agent.app.name": "test-app" },
    attributes: {},
    input_tokens: null,
    output_tokens: null,
    cached_input_tokens: null,
    cost_micros: null,
    ...overrides,
  };
}
