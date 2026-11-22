import type { RuleEvaluatorDefinition } from "@agent-ops/contracts";

import {
  evaluateRule,
  RuleEvaluationUnscorableError,
} from "../domain/rule-evaluation.js";

export interface EvaluationWorkCase {
  evaluationCaseId: string;
  caseId: string;
  candidateTraceId: string;
  expectedOutputContentRef: string | null;
  candidateOutputContentRef: string | null;
  latencyMs: number | null;
  costMicros: number | null;
  toolErrorCount: number | null;
}

export interface EvaluationWork {
  evaluationId: string;
  evaluatorVersionId: string;
  evaluator: RuleEvaluatorDefinition;
  cases: EvaluationWorkCase[];
}

export interface RuleResultWrite {
  evaluationCaseId: string;
  status: "completed" | "unscorable" | "failed";
  score: number | null;
  passed: boolean | null;
  reason: string | null;
  error: string | null;
}

export interface EvaluationWorkerStore {
  claimNextRun(): Promise<EvaluationWork | null>;
  readText(contentId: string): Promise<string | null>;
  saveCaseResult(
    evaluationId: string,
    evaluatorVersionId: string,
    result: RuleResultWrite,
  ): Promise<void>;
  completeRun(evaluationId: string): Promise<void>;
  markFailed(evaluationId: string, error: Error): Promise<void>;
}

export interface EvaluationWorker {
  processNextRun(): Promise<boolean>;
}

export function createEvaluationWorker(
  store: EvaluationWorkerStore,
): EvaluationWorker {
  return {
    async processNextRun() {
      const work = await store.claimNextRun();
      if (work === null) {
        return false;
      }
      try {
        for (const evaluationCase of work.cases) {
          let result: RuleResultWrite;
          try {
            const [candidateOutput, expectedOutput] = await Promise.all([
              readOptionalContent(store, evaluationCase.candidateOutputContentRef),
              readOptionalContent(store, evaluationCase.expectedOutputContentRef),
            ]);
            const evaluation = evaluateRule(work.evaluator, {
              expectedOutput,
              candidateOutput,
              latencyMs: evaluationCase.latencyMs,
              costMicros: evaluationCase.costMicros,
              toolErrorCount: evaluationCase.toolErrorCount,
            });
            result = {
              evaluationCaseId: evaluationCase.evaluationCaseId,
              status: "completed",
              score: evaluation.score,
              passed: evaluation.pass,
              reason: evaluation.reason,
              error: null,
            };
          } catch (error) {
            if (error instanceof RuleEvaluationUnscorableError) {
              result = {
                evaluationCaseId: evaluationCase.evaluationCaseId,
                status: "unscorable",
                score: null,
                passed: null,
                reason: error.message,
                error: null,
              };
            } else {
              result = {
                evaluationCaseId: evaluationCase.evaluationCaseId,
                status: "failed",
                score: null,
                passed: null,
                reason: null,
                error: errorMessage(error),
              };
            }
          }
          await store.saveCaseResult(
            work.evaluationId,
            work.evaluatorVersionId,
            result,
          );
        }
        await store.completeRun(work.evaluationId);
        return true;
      } catch (error) {
        await store.markFailed(work.evaluationId, toError(error));
        throw error;
      }
    },
  };
}

async function readOptionalContent(
  store: EvaluationWorkerStore,
  contentId: string | null,
): Promise<string | null> {
  return contentId === null ? null : store.readText(contentId);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function errorMessage(error: unknown): string {
  const message = toError(error).message.trim();
  return message.slice(0, 2000);
}
