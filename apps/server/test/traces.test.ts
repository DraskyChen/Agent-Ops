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
      {
        list,
        listSessions: async () => [],
        listBySession: async () => [],
        get: async () => null,
      },
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

  it("normalizes session directory searches and limits", async () => {
    const listSessions = vi.fn().mockResolvedValue([]);
    const traces = createTraceQueryService(
      {
        list: async () => ({ items: [], nextCursor: null }),
        listSessions,
        listBySession: async () => [],
        get: async () => null,
      },
      { now: () => new Date("2026-11-24T10:00:00.000Z") },
    );

    const result = await traces.listSessions({
      search: " refund ",
      limit: 999,
    });

    expect(listSessions).toHaveBeenCalledWith({
      search: "refund",
      startedAfter: "2026-10-25T10:00:00.000Z",
      limit: 200,
    });
    expect(result).toMatchObject({
      windowHours: 720,
      generatedAt: "2026-11-24T10:00:00.000Z",
      items: [],
    });
  });

  it("aggregates a session from its ordered trace runs", async () => {
    const traces = createTraceQueryService({
      list: async () => ({ items: [], nextCursor: null }),
      listSessions: async () => [],
      listBySession: async () => [
        traceRun({
          traceId: "trace-1",
          startedAt: "2026-11-24T10:00:00.000Z",
          latencyMs: 100,
          runStatus: "failed",
          appName: "refund-agent",
          costMicros: 1000,
          inputTokens: 10,
          outputTokens: 5,
          toolErrorCount: 1,
        }),
        traceRun({
          traceId: "trace-2",
          startedAt: "2026-11-24T10:00:05.000Z",
          latencyMs: 200,
          runStatus: "success",
          appName: "refund-agent",
          costMicros: 2000,
          inputTokens: 20,
          outputTokens: 10,
          toolErrorCount: 0,
        }),
      ],
      get: async () => null,
    });

    await expect(traces.getSession(" session-1 ")).resolves.toMatchObject({
      sessionId: "session-1",
      traceCount: 2,
      firstStartedAt: "2026-11-24T10:00:00.000Z",
      lastEndedAt: "2026-11-24T10:00:05.200Z",
      durationMs: 5200,
      totalCostMicros: 3000,
      inputTokens: 30,
      outputTokens: 15,
      toolErrorCount: 1,
      statusCounts: {
        failed: 1,
        success: 1,
      },
      appNames: ["refund-agent"],
    });
  });

  it("rejects invalid dates, ranges, review states, and cursors", () => {
    expect(() =>
      createTraceQueryService({
        list: async () => ({ items: [], nextCursor: null }),
        listSessions: async () => [],
        listBySession: async () => [],
        get: async () => null,
      }).list({ startedAfter: "not-a-date" }),
    ).toThrow(InvalidTraceQueryError);

    expect(() =>
      createTraceQueryService({
        list: async () => ({ items: [], nextCursor: null }),
        listSessions: async () => [],
        listBySession: async () => [],
        get: async () => null,
      }).list({
        startedAfter: "2026-11-21T12:00:00.000Z",
        startedBefore: "2026-11-21T10:00:00.000Z",
      }),
    ).toThrow(/startedBefore/);

    expect(() =>
      createTraceQueryService({
        list: async () => ({ items: [], nextCursor: null }),
        listSessions: async () => [],
        listBySession: async () => [],
        get: async () => null,
      }).list({ reviewStatus: "unknown" }),
    ).toThrow(/reviewStatus/);

    expect(() => decodeTraceCursor("not-base64-json")).toThrow(
      /Invalid trace cursor/,
    );
  });
});

function traceRun(overrides: {
  traceId: string;
  startedAt: string;
  latencyMs: number;
  runStatus: "success" | "failed";
  appName: string;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  toolErrorCount: number;
}) {
  return {
    traceId: overrides.traceId,
    runName: "run",
    sessionId: "session-1",
    appName: overrides.appName,
    serviceVersion: "1.0.0",
    taskType: "refund",
    model: "deepseek-flash",
    promptVersion: "v1",
    evalCaseId: null,
    environment: "test" as const,
    runStatus: overrides.runStatus,
    latencyMs: overrides.latencyMs,
    costMicros: overrides.costMicros,
    inputTokens: overrides.inputTokens,
    outputTokens: overrides.outputTokens,
    stepCount: 2,
    toolErrorCount: overrides.toolErrorCount,
    reviewStatus: "unreviewed" as const,
    startedAt: overrides.startedAt,
    ingestState: "sealed_complete" as const,
  };
}
