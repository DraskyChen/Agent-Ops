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
          schedule: async () => undefined,
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
          schedule: async () => undefined,
          complete: async () => undefined,
        }),
      markFailed,
    });

    await expect(worker.processNextJob()).resolves.toBe(false);
    expect(markFailed).not.toHaveBeenCalled();
  });

  it("reschedules an open trace for its sealing deadline", async () => {
    const saveTrace = vi.fn().mockResolvedValue(undefined);
    const schedule = vi.fn().mockResolvedValue(undefined);
    const complete = vi.fn().mockResolvedValue(undefined);
    const worker = createTraceAggregationWorker(
      {
        transaction: async (work) =>
          work({
            claimNextTraceId: async () => "trace-1",
            loadSpans: async () => [
              {
                trace_id: "trace-1",
                span_id: "root",
                parent_span_id: null,
                service_name: "test",
                service_version: "1",
                environment: "test",
                span_type: "agent.run",
                name: "run",
                start_time: new Date("2026-11-21T11:59:00.000Z"),
                end_time: new Date("2026-11-21T12:00:00.000Z"),
                duration_ms: "60000",
                status: "OK",
                resource_attributes: {},
                attributes: {},
                input_tokens: null,
                output_tokens: null,
                cached_input_tokens: null,
                cost_micros: null,
              },
            ],
            priceSpans: async () => undefined,
            saveTrace,
            schedule,
            complete,
          }),
        markFailed: vi.fn(),
      },
      {
        now: () => new Date("2026-11-21T12:00:30.000Z"),
        rootSealGraceMs: 120_000,
      },
    );

    await expect(worker.processNextJob()).resolves.toBe(true);
    expect(saveTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        ingestState: "open",
        sealAfter: new Date("2026-11-21T12:02:00.000Z"),
      }),
    );
    expect(schedule).toHaveBeenCalledWith(
      "trace-1",
      new Date("2026-11-21T12:02:00.000Z"),
    );
    expect(complete).not.toHaveBeenCalled();
  });
});
