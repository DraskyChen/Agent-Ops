import { describe, expect, it, vi } from "vitest";

import type { HumanPrincipal } from "../src/application/auth.js";
import {
  CandidateNotFoundError,
  createCandidateService,
  type CandidateRepository,
} from "../src/application/candidates.js";
import type { TraceCandidate } from "@agent-ops/contracts";

const principal: HumanPrincipal = {
  subject: "reviewer-1",
  displayName: "Reviewer One",
  email: null,
  role: "reviewer",
};

describe("candidate service", () => {
  it("aggregates active and dismissed candidate counts", async () => {
    const list = vi.fn().mockResolvedValue([
      candidate({
        traceId: "trace-1",
        reasons: ["negative_feedback", "review_open"],
      }),
      candidate({
        traceId: "trace-2",
        reasons: ["runtime_failure", "evaluation_failed"],
      }),
      candidate({
        traceId: "trace-3",
        reasons: ["evaluation_blocked"],
        dismissedAt: "2026-11-24T09:00:00.000Z",
      }),
    ]);
    const service = createCandidateService(repository({ list }), {
      now: () => new Date("2026-11-24T10:00:00.000Z"),
      windowHours: 720,
    });

    const result = await service.list();

    expect(list).toHaveBeenCalledWith("2026-10-25T10:00:00.000Z");
    expect(result.counts).toEqual({
      active: 2,
      negativeFeedback: 1,
      reviewOpen: 1,
      runtimeFailure: 1,
      evaluationFailed: 1,
      evaluationBlocked: 0,
      dismissed: 1,
    });
  });

  it("records dismissals and restorations with the acting reviewer", async () => {
    const dismiss = vi.fn().mockResolvedValue(true);
    const restore = vi.fn().mockResolvedValue(true);
    const service = createCandidateService(
      repository({ dismiss, restore }),
      { now: () => new Date("2026-11-24T10:00:00.000Z") },
    );

    await expect(
      service.dismiss(" trace-1 ", principal, { reason: " duplicate " }),
    ).resolves.toEqual({ traceId: "trace-1", dismissed: true });
    expect(dismiss).toHaveBeenCalledWith(
      "trace-1",
      principal,
      "duplicate",
      new Date("2026-11-24T10:00:00.000Z"),
    );

    await expect(service.restore("trace-1")).resolves.toEqual({
      traceId: "trace-1",
      dismissed: false,
    });

    const missing = createCandidateService(
      repository({ dismiss: vi.fn().mockResolvedValue(false) }),
    );
    await expect(
      missing.dismiss("missing", principal, {}),
    ).rejects.toBeInstanceOf(CandidateNotFoundError);
  });
});

function repository(
  overrides: Partial<CandidateRepository> = {},
): CandidateRepository {
  return {
    list: async () => [],
    dismiss: async () => true,
    restore: async () => true,
    ...overrides,
  };
}

function candidate(
  overrides: Partial<TraceCandidate> = {},
): TraceCandidate {
  return {
    traceId: "trace-1",
    runName: "refund-agent",
    sessionId: null,
    appName: "refund-app",
    serviceVersion: "1.0.0",
    taskType: "refund",
    model: "deepseek-flash",
    promptVersion: "refund-v1",
    evalCaseId: "refund-case-1",
    environment: "test",
    runStatus: "success",
    latencyMs: 100,
    costMicros: 1000,
    inputTokens: 10,
    outputTokens: 5,
    stepCount: 2,
    toolErrorCount: 0,
    reviewStatus: "unreviewed",
    startedAt: "2026-11-24T09:00:00.000Z",
    ingestState: "sealed_complete",
    reasons: ["negative_feedback"],
    feedbackTypes: ["thumbs_down"],
    reviewIssueArea: null,
    evaluationFailureCount: 0,
    evaluationBlockedCount: 0,
    datasetCount: 0,
    datasetEligible: true,
    dismissedAt: null,
    dismissedBy: null,
    ...overrides,
  };
}
