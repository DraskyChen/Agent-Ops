import { describe, expect, it, vi } from "vitest";

import {
  createTraceQueryService,
  decodeTraceCursor,
  encodeTraceCursor,
  InvalidTraceQueryError,
} from "../src/application/traces.js";

describe("trace query service", () => {
  it("normalizes filters and applies the default 24 hour window", async () => {
    const list = vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const traces = createTraceQueryService(
      { list, get: async () => null },
      { now: () => new Date("2026-11-21T12:00:00.000Z") },
    );

    await traces.list({
      appName: " refund-agent ",
      taskType: "refund",
      model: "deepseek-flash",
      evalCaseId: " refund-case-001 ",
      reviewStatus: "unreviewed",
      hasErrors: "true",
      status: "failed",
      environment: "prod",
      limit: 999,
    });

    expect(list).toHaveBeenCalledWith({
      appName: "refund-agent",
      taskType: "refund",
      model: "deepseek-flash",
      evalCaseId: "refund-case-001",
      reviewStatus: "unreviewed",
      hasErrors: "true",
      status: "failed",
      environment: "prod",
      startedAfter: "2026-11-20T12:00:00.000Z",
      limit: 200,
    });
  });

  it("round trips opaque cursors", () => {
    const cursor = {
      startedAt: "2026-11-21T10:00:00.000Z",
      traceId: "trace-1",
    };
    expect(decodeTraceCursor(encodeTraceCursor(cursor))).toEqual(cursor);
  });

  it("rejects invalid dates, ranges, review states, and cursors", () => {
    expect(() =>
      createTraceQueryService({
        list: async () => ({ items: [], nextCursor: null }),
        get: async () => null,
      }).list({ startedAfter: "not-a-date" }),
    ).toThrow(InvalidTraceQueryError);

    expect(() =>
      createTraceQueryService({
        list: async () => ({ items: [], nextCursor: null }),
        get: async () => null,
      }).list({
        startedAfter: "2026-11-21T12:00:00.000Z",
        startedBefore: "2026-11-21T10:00:00.000Z",
      }),
    ).toThrow(/startedBefore/);

    expect(() =>
      createTraceQueryService({
        list: async () => ({ items: [], nextCursor: null }),
        get: async () => null,
      }).list({ reviewStatus: "unknown" }),
    ).toThrow(/reviewStatus/);

    expect(() => decodeTraceCursor("not-base64-json")).toThrow(
      /Invalid trace cursor/,
    );
  });
});
