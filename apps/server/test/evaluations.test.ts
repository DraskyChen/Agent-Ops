import { describe, expect, it, vi } from "vitest";

import type { HumanPrincipal } from "../src/application/auth.js";
import {
  EvaluationComparisonError,
  EvaluationPermissionError,
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

  it("lists and creates normalized evaluator templates", async () => {
    const template = {
      evaluatorId: "00000000-0000-4000-8000-000000000020",
      evaluator: {
        name: "contains-refund",
        version: 1,
        kind: "contains" as const,
        config: { value: "refund" },
      },
      createdBy: "Reviewer One",
      createdAt: "2026-11-24T10:00:00.000Z",
    };
    const listEvaluators = vi.fn().mockResolvedValue([template]);
    const createEvaluator = vi.fn().mockResolvedValue(template);
    const evaluations = createEvaluationService(
      repository({ listEvaluators, createEvaluator }),
    );

    await expect(evaluations.listEvaluators()).resolves.toEqual([template]);
    await evaluations.createEvaluator(principal, {
      evaluator: {
        name: " contains-refund ",
        version: 1,
        kind: "contains",
        config: { value: " refund " },
      },
    });

    expect(createEvaluator).toHaveBeenCalledWith(principal, {
      name: "contains-refund",
      version: 1,
      kind: "contains",
      config: { value: "refund" },
    });
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

  it("requires an enabled deployment and admin role for LLM Judge", async () => {
    const create = vi.fn().mockResolvedValue(evaluationDetail());
    const repository = { create };
    const disabled = createEvaluationService(repository, {
      judgeEnabled: false,
    });

    expect(() =>
      disabled.create(principal, {
        datasetRevisionId: "00000000-0000-4000-8000-000000000001",
        evaluator: judgeDefinition(),
        traceSelector: {},
      }),
    ).toThrow(EvaluationValidationError);

    const enabled = createEvaluationService(repository, {
      judgeEnabled: true,
    });
    expect(() =>
      enabled.create(principal, {
        datasetRevisionId: "00000000-0000-4000-8000-000000000001",
        evaluator: judgeDefinition(),
        traceSelector: {},
      }),
    ).toThrow(EvaluationPermissionError);

    await enabled.create(
      { ...principal, subject: "admin-1", role: "admin" },
      {
        datasetRevisionId: "00000000-0000-4000-8000-000000000001",
        evaluator: judgeDefinition(),
        traceSelector: {},
      },
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("compares paired cases from the same evaluator version", async () => {
    const baseline = evaluationDetail({
      evaluationId: "00000000-0000-4000-8000-000000000010",
      status: "completed",
      passedCases: 0,
      scoredCases: 1,
      averageScore: 0.25,
      cases: [evaluationCase(0.25, false, 120, 100)],
    });
    const candidate = evaluationDetail({
      evaluationId: "00000000-0000-4000-8000-000000000011",
      status: "completed",
      passedCases: 1,
      scoredCases: 1,
      averageScore: 0.9,
      cases: [evaluationCase(0.9, true, 80, 70)],
    });
    const mismatched = evaluationDetail({
      evaluationId: "00000000-0000-4000-8000-000000000012",
      evaluatorVersion: 2,
    });
    const evaluations = createEvaluationService(
      repository({
        get: vi.fn(async (id: string) => {
          if (id === baseline.evaluationId) {
            return baseline;
          }
          return id === candidate.evaluationId ? candidate : mismatched;
        }),
      }),
    );

    const comparison = await evaluations.compare(
      baseline.evaluationId,
      candidate.evaluationId,
    );

    expect(comparison).toMatchObject({
      pairedCases: 1,
      baselineOnlyCases: 0,
      candidateOnlyCases: 0,
      cases: [
        {
          caseId: "case-1",
          scoreDelta: 0.65,
          latencyDeltaMs: -40,
          costDeltaMicros: -30,
        },
      ],
    });

    await expect(
      evaluations.compare(
        baseline.evaluationId,
        mismatched.evaluationId,
      ),
    ).rejects.toBeInstanceOf(EvaluationComparisonError);
  });
});

function repository(
  overrides: Partial<EvaluationRepository> = {},
): EvaluationRepository {
  return {
    list: async () => [],
    listEvaluators: async () => [],
    createEvaluator: async (_principal, evaluator) => ({
      evaluatorId: "00000000-0000-4000-8000-000000000020",
      evaluator,
      createdBy: "Reviewer One",
      createdAt: "2026-11-24T10:00:00.000Z",
    }),
    get: async () => null,
    create: async () => evaluationDetail(),
    cancel: async () => evaluationDetail(),
    ...overrides,
  };
}

function judgeDefinition() {
  return {
    name: "quality-judge",
    version: 1,
    kind: "llm_judge" as const,
    config: {
      model: "deepseek-flash",
      rubric: "Pass when the answer is complete and grounded in the input.",
      allowExternalContent: true as const,
      temperature: 0,
    },
  };
}

function evaluationDetail(
  overrides: Partial<ReturnType<typeof baseEvaluationDetail>> = {},
) {
  return {
    ...baseEvaluationDetail(),
    ...overrides,
  };
}

function baseEvaluationDetail() {
  return {
    evaluationId: "00000000-0000-4000-8000-000000000002",
    datasetId: "00000000-0000-4000-8000-000000000003",
    datasetName: "Refund regressions",
    datasetRevisionId: "00000000-0000-4000-8000-000000000001",
    datasetRevision: 1,
    evaluatorName: "exact",
    evaluatorVersion: 1,
    evaluatorKind: "exact" as const,
    evaluator: {
      name: "exact",
      version: 1,
      kind: "exact" as const,
      config: {},
    },
    candidateAppName: "refund-agent" as string | null,
    candidatePromptVersion: "refund-v2" as string | null,
    status: "queued" as
      | "queued"
      | "running"
      | "completed"
      | "failed"
      | "cancelled",
    totalCases: 1,
    scoredCases: 0,
    passedCases: 0,
    failedCases: 0,
    missingCases: 0,
    unscorableCases: 0,
    erroredCases: 0,
    averageScore: null as number | null,
    averageCostMicros: null as number | null,
    p50LatencyMs: null as number | null,
    p95LatencyMs: null as number | null,
    requestedBy: "Reviewer One",
    createdAt: "2026-11-22T13:00:00.000Z",
    startedAt: null as string | null,
    completedAt: null as string | null,
    lastError: null as string | null,
    traceSelector: {},
    cases: [] as ReturnType<typeof evaluationCase>[],
  };
}

function evaluationCase(
  score: number,
  passed: boolean,
  latencyMs: number,
  costMicros: number,
) {
  return {
    evaluationCaseId: "case-result-1",
    datasetItemId: "item-1",
    caseId: "case-1",
    candidateTraceId: "trace-1",
    status: "completed" as const,
    score,
    passed,
    reason: "result",
    error: null,
    judgeCall: null,
    latencyMs,
    costMicros,
  };
}
