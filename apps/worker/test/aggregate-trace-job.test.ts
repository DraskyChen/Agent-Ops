import { describe, expect, it, vi } from "vitest";

import { createTraceAggregationWorker } from "../src/application/aggregate-trace-job.js";

describe("trace aggregation job", () => {
  it("reports a failed job after the transaction rolls back", async () => {
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const worker = createTraceAggregationWorker({
      transaction: async (work) =>
        work({
          claimNextTraceId: async () => "trace-1",
          loadSpans: async () => [],
          priceSpans: async () => undefined,
          saveTrace: async () => undefined,
          complete: async () => undefined,
        }),
      markFailed,
    });

    await expect(worker.processNextJob()).rejects.toThrow(
      "has no usable spans",
    );
    expect(markFailed).toHaveBeenCalledWith(
      "trace-1",
      expect.objectContaining({
        message: "Trace trace-1 has no usable spans",
      }),
    );
  });

  it("does not report a failure when the queue is empty", async () => {
    const markFailed = vi.fn();
    const worker = createTraceAggregationWorker({
      transaction: async (work) =>
        work({
          claimNextTraceId: async () => null,
          loadSpans: async () => [],
          priceSpans: async () => undefined,
          saveTrace: async () => undefined,
          complete: async () => undefined,
        }),
      markFailed,
    });

    await expect(worker.processNextJob()).resolves.toBe(false);
    expect(markFailed).not.toHaveBeenCalled();
  });
});
