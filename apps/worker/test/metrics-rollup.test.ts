import { describe, expect, it, vi } from "vitest";

import { createMetricsRollupWorker } from "../src/application/metrics-rollup.js";

describe("metrics rollup worker", () => {
  it("rebuilds and completes a claimed bucket", async () => {
    const replaceBucket = vi.fn().mockResolvedValue(undefined);
    const complete = vi.fn().mockResolvedValue(undefined);
    const bucket = new Date("2026-11-22T00:00:00.000Z");
    const worker = createMetricsRollupWorker({
      transaction: async (work) =>
        work({
          claimNextBucket: async () => bucket,
          loadFacts: async () => [],
          replaceBucket,
          complete,
        }),
      markFailed: vi.fn(),
      rebuildBucket: vi.fn(),
    });

    await expect(worker.processNextJob()).resolves.toBe(true);
    expect(replaceBucket).toHaveBeenCalledWith(bucket, []);
    expect(complete).toHaveBeenCalledWith(bucket);
  });

  it("marks a failed bucket for retry", async () => {
    const bucket = new Date("2026-11-22T00:00:00.000Z");
    const markFailed = vi.fn().mockResolvedValue(undefined);
    const worker = createMetricsRollupWorker({
      transaction: async (work) =>
        work({
          claimNextBucket: async () => bucket,
          loadFacts: async () => {
            throw new Error("database unavailable");
          },
          replaceBucket: vi.fn(),
          complete: vi.fn(),
        }),
      markFailed,
      rebuildBucket: vi.fn(),
    });

    await expect(worker.processNextJob()).rejects.toThrow(
      "database unavailable",
    );
    expect(markFailed).toHaveBeenCalledWith(
      bucket,
      expect.objectContaining({ message: "database unavailable" }),
    );
  });
});
