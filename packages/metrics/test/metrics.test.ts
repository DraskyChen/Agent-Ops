import { describe, expect, it } from "vitest";

import {
  aggregateRollupRows,
  buildHourlyRollupRows,
  granularityForRange,
  type MetricFact,
} from "../src/index.js";

describe("trace metrics", () => {
  it("builds rollups with finalized statuses and tool-error denominators", () => {
    const bucket = new Date("2026-11-22T00:00:00.000Z");
    const rows = buildHourlyRollupRows(
      [
        fact({ runStatus: "success", toolCallCount: 2, toolErrorCount: 0 }),
        fact({ runStatus: "failed", toolCallCount: 1, toolErrorCount: 1 }),
        fact({ runStatus: null, toolCallCount: 0, toolErrorCount: 0 }),
      ],
      bucket,
    );
    const totals = aggregateRollupRows(rows);

    expect(totals.traceCount).toBe(3);
    expect(totals.finalizedTraceCount).toBe(2);
    expect(totals.statusCounts.unknown).toBe(1);
    expect(totals.toolTraceCount).toBe(2);
    expect(totals.toolErrorTraceCount).toBe(1);
  });

  it("estimates latency percentiles from cumulative buckets", () => {
    const rows = buildHourlyRollupRows(
      [
        fact({ durationMs: 100 }),
        fact({ durationMs: 300 }),
        fact({ durationMs: 900 }),
        fact({ durationMs: 1_500 }),
      ],
      new Date("2026-11-22T00:00:00.000Z"),
    );
    const totals = aggregateRollupRows(rows);

    expect(totals.p50LatencyMs).toBeGreaterThan(200);
    expect(totals.p95LatencyMs).toBeGreaterThan(1_000);
  });

  it("does not add open or partial traces to latency percentiles", () => {
    const rows = buildHourlyRollupRows(
      [
        fact({ durationMs: 100, ingestState: "open" }),
        fact({ durationMs: 200, ingestState: "sealed_partial" }),
      ],
      new Date("2026-11-22T00:00:00.000Z"),
    );
    const totals = aggregateRollupRows(rows);

    expect(totals.p50LatencyMs).toBeNull();
    expect(totals.p95LatencyMs).toBeNull();
  });

  it("chooses hour, six-hour, and day granularity from range size", () => {
    const start = new Date("2026-11-01T00:00:00.000Z");
    expect(
      granularityForRange(start, new Date("2026-11-02T00:00:00.000Z")),
    ).toBe("hour");
    expect(
      granularityForRange(start, new Date("2026-11-05T00:00:00.000Z")),
    ).toBe("six_hour");
    expect(
      granularityForRange(start, new Date("2026-11-29T00:00:00.000Z")),
    ).toBe("day");
  });
});

function fact(overrides: Partial<MetricFact> = {}): MetricFact {
  return {
    startTime: new Date("2026-11-22T00:15:00.000Z"),
    appName: "agent",
    environment: "prod",
    taskType: "support",
    model: "deepseek-flash",
    promptVersion: "v1",
    serviceVersion: "1.0.0",
    runStatus: "success",
    durationMs: 100,
    ingestState: "sealed_complete",
    costMicros: 100,
    inputTokens: 10,
    outputTokens: 20,
    toolCallCount: 1,
    toolErrorCount: 0,
    ...overrides,
  };
}
