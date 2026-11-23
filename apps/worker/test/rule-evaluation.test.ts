import { describe, expect, it } from "vitest";

import {
  evaluateRule,
  RuleEvaluationUnscorableError,
} from "../src/domain/rule-evaluation.js";

describe("rule evaluation", () => {
  it("evaluates deterministic output comparators", () => {
    expect(
      evaluateRule(
        {
          name: "exact",
          version: 1,
          kind: "exact",
          config: { ignoreCase: true },
        },
        evaluationCase({
          expectedOutput: "REFUND COMPLETED",
          candidateOutput: " refund completed ",
        }),
      ),
    ).toMatchObject({ score: 1, pass: true });

    expect(
      evaluateRule(
        {
          name: "contains",
          version: 1,
          kind: "contains",
          config: { value: "completed", ignoreCase: true },
        },
        evaluationCase({ candidateOutput: "Refund COMPLETED successfully" }),
      ),
    ).toMatchObject({ score: 1, pass: true });

    expect(
      evaluateRule(
        {
          name: "json",
          version: 1,
          kind: "json_valid",
          config: {},
        },
        evaluationCase({ candidateOutput: '{"ok":true}' }),
      ),
    ).toMatchObject({ score: 1, pass: true });
  });

  it("evaluates trace metrics and rejects missing metrics", () => {
    expect(
      evaluateRule(
        {
          name: "latency",
          version: 1,
          kind: "max_latency_ms",
          config: { value: 1000 },
        },
        evaluationCase({ latencyMs: 800 }),
      ),
    ).toMatchObject({ score: 1, pass: true });

    expect(() =>
      evaluateRule(
        {
          name: "cost",
          version: 1,
          kind: "max_cost_micros",
          config: { value: 1000 },
        },
        evaluationCase({ costMicros: null }),
      ),
    ).toThrow(RuleEvaluationUnscorableError);
  });
});

function evaluationCase(
  overrides: Partial<ReturnType<typeof baseCase>> = {},
) {
  return { ...baseCase(), ...overrides };
}

function baseCase() {
  return {
    expectedOutput: "refund completed",
    candidateOutput: "refund completed",
    latencyMs: 500,
    costMicros: 100,
    toolErrorCount: 0,
  };
}
