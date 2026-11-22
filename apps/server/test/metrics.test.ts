import type { MetricRollupRow } from "@agent-ops/metrics";
import { describe, expect, it } from "vitest";

import {
  createMetricsService,
  InvalidMetricsQueryError,
} from "../src/application/metrics.js";

describe("metrics service", () => {
  it("returns bucket-aligned summaries and series", async () => {
    const metrics = createMetricsService(
      {
        async load() {
          return {
            rows: [
              row({
                bucketStart: new Date("2026-11-22T00:00:00.000Z"),
                traceCount: 2,
                successCount: 1,
                failedCount: 1,
              }),
              row({
                bucketStart: new Date("2026-11-22T01:00:00.000Z"),
                model: "deepseek-v4-pro",
                traceCount: 1,
                successCount: 1,
                failedCount: 0,
              }),
            ],
            dataThrough: new Date("2026-11-22T02:00:00.000Z"),
          };
        },
      },
      { now: () => new Date("2026-11-22T01:20:00.000Z") },
    );

    const response = await metrics.overview({
      startedAfter: "2026-11-22T00:00:00.000Z",
      startedBefore: "2026-11-22T01:20:00.000Z",
    });

    expect(response.scope).toMatchObject({
      startedAfter: "2026-11-22T00:00:00.000Z",
      startedBefore: "2026-11-22T02:00:00.000Z",
      granularity: "hour",
      dataThrough: "2026-11-22T02:00:00.000Z",
    });
    expect(response.summary.traceCount).toBe(3);
    expect(response.summary.successRate).toBeCloseTo(2 / 3);
    expect(response.series).toHaveLength(2);
  });

  it("groups a selected dimension and sorts by trace count", async () => {
    const metrics = createMetricsService({
      async load() {
        return {
          rows: [
            row({ model: "small", traceCount: 1 }),
            row({ model: "large", traceCount: 3 }),
          ],
          dataThrough: null,
        };
      },
    });

    const response = await metrics.breakdown({
      startedAfter: "2026-11-22T00:00:00.000Z",
      startedBefore: "2026-11-22T01:00:00.000Z",
      dimension: "model",
    });

    expect(response.items.map((item) => item.value)).toEqual([
      "large",
      "small",
    ]);
    expect(response.items[0]?.traceShare).toBe(0.75);
  });

  it("rejects invalid ranges and dimensions", async () => {
    const metrics = createMetricsService({
      load: async () => ({ rows: [], dataThrough: null }),
    });

    await expect(
      metrics.overview({
        startedAfter: "2026-11-22T02:00:00.000Z",
        startedBefore: "2026-11-22T01:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(InvalidMetricsQueryError);

    await expect(
      metrics.breakdown({
        dimension: "invalid" as "app",
      }),
    ).rejects.toBeInstanceOf(InvalidMetricsQueryError);
  });
});

function row(overrides: Partial<MetricRollupRow> = {}): MetricRollupRow {
  return {
    bucketStart: new Date("2026-11-22T00:00:00.000Z"),
    appName: "agent",
    environment: "prod",
    taskType: "support",
    model: "deepseek-flash",
    promptVersion: "v1",
    serviceVersion: "1.0.0",
    runStatus: "success",
    traceCount: 1,
    successCount: 1,
    failedCount: 0,
    partialCount: 0,
    cancelledCount: 0,
    timeoutCount: 0,
    unknownCount: 0,
    costMicros: 100,
    inputTokens: 10,
    outputTokens: 20,
    toolCallCount: 1,
    toolTraceCount: 1,
    toolErrorTraceCount: 0,
    durationCount: 1,
    latencyLe50: 0,
    latencyLe100: 1,
    latencyLe250: 1,
    latencyLe500: 1,
    latencyLe1000: 1,
    latencyLe2000: 1,
    latencyLe5000: 1,
    latencyLe10000: 1,
    latencyLe30000: 1,
    latencyLe60000: 1,
    ...overrides,
  };
}
