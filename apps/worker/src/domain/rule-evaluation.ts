import type { RuleEvaluatorDefinition } from "@agent-ops/contracts";

export interface RuleEvaluationCase {
  expectedOutput: string | null;
  candidateOutput: string | null;
  latencyMs: number | null;
  costMicros: number | null;
  toolErrorCount: number | null;
}

export interface RuleEvaluationResult {
  score: number;
  pass: boolean;
  reason: string;
}

export class RuleEvaluationUnscorableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleEvaluationUnscorableError";
  }
}

export function evaluateRule(
  evaluator: RuleEvaluatorDefinition,
  input: RuleEvaluationCase,
): RuleEvaluationResult {
  switch (evaluator.kind) {
    case "exact": {
      const expected = requiredExpected(input.expectedOutput);
      const candidate = requiredCandidate(input.candidateOutput);
      const equal = evaluator.config.ignoreCase
        ? expected.toLocaleLowerCase() === candidate.toLocaleLowerCase()
        : expected === candidate;
      return binary(equal, "Candidate output matches expected output");
    }
    case "contains": {
      const candidate = requiredCandidate(input.candidateOutput);
      const haystack = evaluator.config.ignoreCase
        ? candidate.toLocaleLowerCase()
        : candidate;
      const needle = evaluator.config.ignoreCase
        ? evaluator.config.value.toLocaleLowerCase()
        : evaluator.config.value;
      return binary(
        haystack.includes(needle),
        `Candidate output ${haystack.includes(needle) ? "contains" : "does not contain"} required text`,
      );
    }
    case "regex": {
      const candidate = requiredCandidate(input.candidateOutput);
      const expression = new RegExp(
        evaluator.config.pattern,
        evaluator.config.ignoreCase ? "i" : "",
      );
      const matched = expression.test(candidate);
      return binary(matched, "Candidate output matches regular expression");
    }
    case "json_valid": {
      const candidate = requiredCandidate(input.candidateOutput);
      try {
        JSON.parse(candidate);
        return binary(true, "Candidate output is valid JSON");
      } catch {
        return binary(false, "Candidate output is not valid JSON");
      }
    }
    case "max_latency_ms":
    case "max_cost_micros":
    case "max_tool_errors": {
      const observed = observedMetric(evaluator.kind, input);
      const passed = observed <= evaluator.config.value;
      return binary(
        passed,
        `${evaluator.kind} observed ${observed}, threshold ${evaluator.config.value}`,
      );
    }
  }
}

function observedMetric(
  kind: "max_latency_ms" | "max_cost_micros" | "max_tool_errors",
  input: RuleEvaluationCase,
): number {
  const value =
    kind === "max_latency_ms"
      ? input.latencyMs
      : kind === "max_cost_micros"
        ? input.costMicros
        : input.toolErrorCount;
  if (value === null) {
    throw new RuleEvaluationUnscorableError(`Metric ${kind} is unavailable`);
  }
  return value;
}

function requiredExpected(value: string | null): string {
  if (value === null || value.trim() === "") {
    throw new RuleEvaluationUnscorableError(
      "Dataset item has no expected output",
    );
  }
  return value.trim();
}

function requiredCandidate(value: string | null): string {
  if (value === null || value.trim() === "") {
    throw new RuleEvaluationUnscorableError(
      "Candidate trace has no output content",
    );
  }
  return value.trim();
}

function binary(passed: boolean, reason: string): RuleEvaluationResult {
  return {
    score: passed ? 1 : 0,
    pass: passed,
    reason: passed ? `${reason}: passed` : `${reason}: failed`,
  };
}
