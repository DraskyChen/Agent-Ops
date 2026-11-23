import { describe, expect, it, vi } from "vitest";

import {
  createEvaluationWorker,
  type EvaluationWorkerStore,
  type RuleResultWrite,
} from "../src/application/evaluate-rule-run.js";

describe("evaluation worker", () => {
  it("evaluates matched cases and completes the run", async () => {
    const saveCaseResult = vi.fn().mockResolvedValue(undefined);
    const completeRun = vi.fn().mockResolvedValue(undefined);
    const worker = createEvaluationWorker({
      claimNextRun: vi.fn().mockResolvedValue({
        evaluationId: "evaluation-1",
        evaluatorVersionId: "version-1",
        evaluator: {
          name: "contains",
          version: 1,
          kind: "contains",
          config: { value: "refunded" },
        },
        cases: [
          {
            evaluationCaseId: "case-result-1",
            caseId: "refund-case-1",
            candidateTraceId: "trace-1",
            inputContentRef: "input-1",
            expectedOutputContentRef: "expected-1",
            candidateOutputContentRef: "output-1",
            expectedBehavior: null,
            latencyMs: 100,
            costMicros: 20,
            toolErrorCount: 0,
          },
        ],
      }),
      readText: vi.fn(async (contentId: string) =>
        contentId === "output-1" ? "Order refunded" : "Refund expected",
      ),
      saveCaseResult,
      saveJudgeCall: vi.fn(),
      completeRun,
      markFailed: vi.fn(),
    });

    await expect(worker.processNextRun()).resolves.toBe(true);

    expect(saveCaseResult).toHaveBeenCalledWith(
      "evaluation-1",
      "version-1",
      {
        evaluationCaseId: "case-result-1",
        status: "completed",
        score: 1,
        passed: true,
        reason: expect.any(String),
        error: null,
      } satisfies RuleResultWrite,
    );
    expect(completeRun).toHaveBeenCalledWith("evaluation-1");
  });

  it("records unscorable cases without failing the whole run", async () => {
    const saveCaseResult = vi.fn().mockResolvedValue(undefined);
    const store: EvaluationWorkerStore = {
      claimNextRun: vi.fn().mockResolvedValue({
        evaluationId: "evaluation-1",
        evaluatorVersionId: "version-1",
        evaluator: {
          name: "exact",
          version: 1,
          kind: "exact",
          config: {},
        },
        cases: [
          {
            evaluationCaseId: "case-result-1",
            caseId: "refund-case-1",
            candidateTraceId: "trace-1",
            inputContentRef: null,
            expectedOutputContentRef: null,
            candidateOutputContentRef: "output-1",
            expectedBehavior: null,
            latencyMs: 100,
            costMicros: 20,
            toolErrorCount: 0,
          },
        ],
      }),
      readText: vi.fn(async () => "candidate"),
      saveCaseResult,
      saveJudgeCall: vi.fn(),
      completeRun: vi.fn().mockResolvedValue(undefined),
      markFailed: vi.fn(),
    };

    await createEvaluationWorker(store).processNextRun();

    expect(saveCaseResult).toHaveBeenCalledWith(
      "evaluation-1",
      "version-1",
      expect.objectContaining({
        status: "unscorable",
        score: null,
      }),
    );
  });

  it("retries invalid JSON and records the successful Judge call", async () => {
    const saveCaseResult = vi.fn().mockResolvedValue(undefined);
    const saveJudgeCall = vi.fn().mockResolvedValue(undefined);
    const evaluate = vi
      .fn()
      .mockResolvedValueOnce({
        content: "not json",
        inputTokens: 20,
        outputTokens: 5,
      })
      .mockResolvedValueOnce({
        content:
          '{"score":0.8,"pass":true,"reason":"Grounded and complete","category":"correct"}',
        inputTokens: 22,
        outputTokens: 12,
      });
    const worker = createEvaluationWorker(
      {
        claimNextRun: vi.fn().mockResolvedValue({
          evaluationId: "evaluation-1",
          evaluatorVersionId: "version-1",
          evaluator: {
            name: "judge",
            version: 1,
            kind: "llm_judge",
            config: {
              model: "deepseek-flash",
              rubric: "Require a complete and grounded response.",
              allowExternalContent: true,
              temperature: 0,
            },
          },
          cases: [
            {
              evaluationCaseId: "case-result-1",
              caseId: "refund-case-1",
              candidateTraceId: "trace-1",
              inputContentRef: "input-1",
              expectedOutputContentRef: "expected-1",
              candidateOutputContentRef: "output-1",
              expectedBehavior: "Use the tool before claiming success",
              latencyMs: 100,
              costMicros: 20,
              toolErrorCount: 0,
            },
          ],
        }),
        readText: vi.fn(async (contentId: string) =>
          contentId === "output-1"
            ? "Refund completed"
            : contentId === "input-1"
              ? "Refund order 123"
              : "Refund completed",
        ),
        saveCaseResult,
        saveJudgeCall,
        completeRun: vi.fn().mockResolvedValue(undefined),
        markFailed: vi.fn(),
      },
      { judgeClient: { evaluate } },
    );

    await worker.processNextRun();

    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(saveJudgeCall).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluationId: "evaluation-1",
        evaluationCaseId: "case-result-1",
        decision: expect.objectContaining({
          score: 0.8,
          category: "correct",
        }),
      }),
    );
    expect(saveCaseResult).toHaveBeenCalledWith(
      "evaluation-1",
      "version-1",
      expect.objectContaining({
        status: "completed",
        score: 0.8,
        passed: true,
      }),
    );
  });
});
