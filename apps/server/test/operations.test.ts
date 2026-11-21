import { describe, expect, it, vi } from "vitest";

import {
  createOperationsService,
  InvalidOperationsQueryError,
} from "../src/application/operations.js";

describe("operations service", () => {
  it("validates and forwards the health window", async () => {
    const ingestHealth = vi.fn().mockResolvedValue({
      windowHours: 24,
      generatedAt: "ignored",
      batches: {
        total: 0,
        accepted: 0,
        partial: 0,
        failed: 0,
        acceptedSpans: 0,
        rejectedSpans: 0,
      },
      rejectsByReason: [],
      aggregation: {
        pending: 0,
        processing: 0,
        failed: 0,
        oldestPendingAt: null,
      },
      content: {
        available: 0,
        unavailable: 0,
        expired: 0,
      },
    });
    const operations = createOperationsService(
      { ingestHealth },
      () => new Date("2026-11-21T12:00:00.000Z"),
    );

    await expect(operations.ingestHealth(24)).resolves.toMatchObject({
      windowHours: 24,
      generatedAt: "2026-11-21T12:00:00.000Z",
    });
    expect(ingestHealth).toHaveBeenCalledWith(24);
  });

  it("rejects windows outside one week", async () => {
    const operations = createOperationsService({
      ingestHealth: vi.fn(),
    });

    await expect(operations.ingestHealth(0)).rejects.toBeInstanceOf(
      InvalidOperationsQueryError,
    );
    await expect(operations.ingestHealth(169)).rejects.toBeInstanceOf(
      InvalidOperationsQueryError,
    );
  });
});
