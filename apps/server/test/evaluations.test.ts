import { describe, expect, it, vi } from "vitest";

import type { HumanPrincipal } from "../src/application/auth.js";
import {
  EvaluationValidationError,
  createEvaluationService,
  normalizeEvaluationCreate,
  type EvaluationRepository,
} from "../src/application/evaluations.js";

const principal: HumanPrincipal = {
  subject: "reviewer-1",
  displayName: "Reviewer One",
  email: null,
  role: "reviewer",
};

describe("evaluation service", () => {
  it("normalizes a bounded trace selector and evaluator version", () => {
    const normalized = normalizeEvaluationCreate(
      {
        datasetRevisionId: "00000000-0000-4000-8000-000000000001",
        evaluator: {
          name: " contains-refund ",
          version: 1,
          kind: "contains",
          config: { value: " refund ", ignoreCase: true },
        },
        traceSelector: {
          appName: " refund-agent ",
          promptVersion: " refund-v2 ",
          environment: "test",
          startedAfter: "2026-11-22T10:00:00.000Z",
          startedBefore: "2026-11-22T12:00:00.000Z",
        },
      },
      new Date("2026-11-22T13:00:00.000Z"),
    );

    expect(normalized).toEqual({
      datasetRevisionId: "00000000-0000-4000-8000-000000000001",
      evaluator: {
        name: "contains-refund",
        version: 1,
        kind: "contains",
        config: { value: "refund", ignoreCase: true },
      },
      traceSelector: {
        appName: "refund-agent",
        promptVersion: "refund-v2",
        environment: "test",
        startedAfter: "2026-11-22T10:00:00.000Z",
        startedBefore: "2026-11-22T12:00:00.000Z",
      },
    });
  });

  it("applies a 24 hour candidate window by default", () => {
    const normalized = normalizeEvaluationCreate(
      {
        datasetRevisionId: "00000000-0000-4000-8000-000000000001",
        evaluator: {
          name: "valid-json",
          version: 1,
          kind: "json_valid",
          config: {},
        },
        traceSelector: {},
      },
      new Date("2026-11-22T13:00:00.000Z"),
    );

    expect(normalized.traceSelector).toEqual({
      startedAfter: "2026-11-21T13:00:00.000Z",
      startedBefore: "2026-11-22T13:00:00.000Z",
    });
  });

  it("rejects invalid regexes before persistence", () => {
    expect(() =>
      normalizeEvaluationCreate(
        {
          datasetRevisionId: "00000000-0000-4000-8000-000000000001",
          evaluator: {
            name: "bad-regex",
            version: 1,
            kind: "regex",
            config: { pattern: "(" },
          },
          traceSelector: {},
        },
        new Date(),
      ),
    ).toThrow(EvaluationValidationError);
  });

  it("delegates run creation with the requesting principal", async () => {
    const create = vi.fn().mockResolvedValue(evaluationDetail());
    const evaluations = createEvaluationService(
      repository({ create }),
      { now: () => new Date("2026-11-22T13:00:00.000Z") },
    );

    await evaluations.create(principal, {
      datasetRevisionId: "00000000-0000-4000-8000-000000000001",
      evaluator: {
        name: "exact",
        version: 1,
        kind: "exact",
        config: {},
      },
      traceSelector: {},
    });

    expect(create).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        datasetRevisionId: "00000000-0000-4000-8000-000000000001",
        traceSelector: {
          startedAfter: "2026-11-21T13:00:00.000Z",
          startedBefore: "2026-11-22T13:00:00.000Z",
        },
      }),
    );
  });
});

function repository(
  overrides: Partial<EvaluationRepository> = {},
): EvaluationRepository {
  return {
    list: async () => [],
    get: async () => null,
    create: async () => evaluationDetail(),
    cancel: async () => evaluationDetail(),
    ...overrides,
  };
}

function evaluationDetail() {
  return {
    evaluationId: "00000000-0000-4000-8000-000000000002",
    datasetId: "00000000-0000-4000-8000-000000000003",
    datasetName: "Refund regressions",
    datasetRevisionId: "00000000-0000-4000-8000-000000000001",
    datasetRevision: 1,
    evaluatorName: "exact",
    evaluatorVersion: 1,
    evaluatorKind: "exact" as const,
    status: "queued" as const,
    totalCases: 1,
    scoredCases: 0,
    passedCases: 0,
    failedCases: 0,
    missingCases: 0,
    unscorableCases: 0,
    erroredCases: 0,
    averageScore: null,
    requestedBy: "Reviewer One",
    createdAt: "2026-11-22T13:00:00.000Z",
    startedAt: null,
    completedAt: null,
    lastError: null,
    traceSelector: {},
    cases: [],
  };
}
