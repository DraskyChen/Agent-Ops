import type { EvaluatorDefinition } from "@agent-ops/contracts";

import type {
  JudgeClient,
  JudgeCallResult,
} from "./judge-client.js";
import {
  evaluateRule,
  RuleEvaluationUnscorableError,
} from "../domain/rule-evaluation.js";
import {
  buildJudgePrompt,
  parseJudgeDecision,
  type JudgeDecision,
  type JudgePrompt,
} from "../domain/llm-judge.js";

export interface EvaluationWorkCase {
  evaluationCaseId: string;
  caseId: string;
  candidateTraceId: string;
  inputContentRef: string | null;
  expectedOutputContentRef: string | null;
  candidateOutputContentRef: string | null;
  expectedBehavior: string | null;
  latencyMs: number | null;
  costMicros: number | null;
  toolErrorCount: number | null;
}

export interface EvaluationWork {
  evaluationId: string;
  evaluatorVersionId: string;
  evaluator: EvaluatorDefinition;
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

export interface JudgeCallWrite {
  evaluationId: string;
  evaluationCaseId: string;
  evaluatorVersionId: string;
  model: string;
  prompt: JudgePrompt;
  response: JudgeCallResult | null;
  decision: JudgeDecision | null;
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
  saveJudgeCall(input: JudgeCallWrite): Promise<void>;
  completeRun(evaluationId: string): Promise<void>;
  markFailed(evaluationId: string, error: Error): Promise<void>;
}

export interface EvaluationWorker {
  processNextRun(): Promise<boolean>;
}

export interface EvaluationWorkerOptions {
  judgeClient?: JudgeClient;
}

export function createEvaluationWorker(
  store: EvaluationWorkerStore,
  options: EvaluationWorkerOptions = {},
): EvaluationWorker {
  return {
    async processNextRun() {
      const work = await store.claimNextRun();
      if (work === null) {
        return false;
      }
      try {
        for (const evaluationCase of work.cases) {
          let result: RuleResultWrite | undefined;
          let judgePrompt: JudgePrompt | null = null;
          let lastJudgeResponse: JudgeCallResult | null = null;
          try {
            const [candidateOutput, expectedOutput, input] = await Promise.all([
              readOptionalContent(
                store,
                evaluationCase.candidateOutputContentRef,
              ),
              readOptionalContent(
                store,
                evaluationCase.expectedOutputContentRef,
              ),
              readOptionalContent(store, evaluationCase.inputContentRef),
            ]);

            if (work.evaluator.kind === "llm_judge") {
              if (
                candidateOutput === null ||
                candidateOutput.trim() === ""
              ) {
                throw new RuleEvaluationUnscorableError(
                  "Candidate trace has no output content",
                );
              }
              judgePrompt = buildJudgePrompt(work.evaluator, {
                input,
                expectedOutput,
                expectedBehavior: evaluationCase.expectedBehavior,
                candidateOutput,
              });
              let lastError: unknown;
              for (let attempt = 0; attempt < 2; attempt += 1) {
                if (options.judgeClient === undefined) {
                  throw new Error(
                    "LLM Judge is enabled but no Judge client is configured",
                  );
                }
                lastJudgeResponse = await options.judgeClient.evaluate({
                  model: work.evaluator.config.model,
                  temperature: work.evaluator.config.temperature,
                  system: judgePrompt.system,
                  user: judgePrompt.user,
                });
                try {
                  const decision = parseJudgeDecision(
                    lastJudgeResponse.content,
                  );
                  await store.saveJudgeCall({
                    evaluationId: work.evaluationId,
                    evaluationCaseId: evaluationCase.evaluationCaseId,
                    evaluatorVersionId: work.evaluatorVersionId,
                    model: work.evaluator.config.model,
                    prompt: judgePrompt,
                    response: lastJudgeResponse,
                    decision,
                    error: null,
                  });
                  result = {
                    evaluationCaseId: evaluationCase.evaluationCaseId,
                    status: "completed",
                    score: decision.score,
                    passed: decision.pass,
                    reason: `[${decision.category}] ${decision.reason}`,
                    error: null,
                  };
                  break;
                } catch (error) {
                  lastError = error;
                }
              }
              if (result === undefined) {
                throw lastError instanceof Error
                  ? lastError
                  : new Error("Judge returned an invalid response");
              }
            } else {
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
            }
          } catch (error) {
            if (
              work.evaluator.kind === "llm_judge" &&
              judgePrompt !== null
            ) {
              await store.saveJudgeCall({
                evaluationId: work.evaluationId,
                evaluationCaseId: evaluationCase.evaluationCaseId,
                evaluatorVersionId: work.evaluatorVersionId,
                model: work.evaluator.config.model,
                prompt: judgePrompt,
                response: lastJudgeResponse,
                decision: null,
                error: errorMessage(error),
              });
            }
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
          if (result === undefined) {
            throw new Error("Evaluation case did not produce a result");
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
