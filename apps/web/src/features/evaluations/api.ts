import type {
  EvaluationCreateRequest,
  EvaluationComparison,
  EvaluationDetail,
  EvaluationSummary,
  EvaluatorTemplate,
  EvaluatorTemplateCreateRequest,
} from "@agent-ops/contracts";

import { getJson, postJson } from "../../shared/http.js";

export async function fetchEvaluations(): Promise<EvaluationSummary[]> {
  return getJson<EvaluationSummary[]>("/api/v1/evaluations");
}

export async function fetchEvaluatorTemplates(): Promise<EvaluatorTemplate[]> {
  return getJson<EvaluatorTemplate[]>("/api/v1/evaluators");
}

export async function createEvaluatorTemplate(
  input: EvaluatorTemplateCreateRequest,
): Promise<EvaluatorTemplate> {
  return postJson<EvaluatorTemplate, EvaluatorTemplateCreateRequest>(
    "/api/v1/evaluators",
    input,
  );
}

export async function fetchEvaluation(
  evaluationId: string,
): Promise<EvaluationDetail> {
  return getJson<EvaluationDetail>(
    `/api/v1/evaluations/${encodeURIComponent(evaluationId)}`,
  );
}

export async function createEvaluation(
  input: EvaluationCreateRequest,
): Promise<EvaluationDetail> {
  return postJson<EvaluationDetail, EvaluationCreateRequest>(
    "/api/v1/evaluations",
    input,
  );
}

export async function cancelEvaluation(
  evaluationId: string,
): Promise<EvaluationDetail> {
  return postJson<EvaluationDetail, Record<string, never>>(
    `/api/v1/evaluations/${encodeURIComponent(evaluationId)}/cancel`,
    {},
  );
}

export async function fetchEvaluationComparison(
  baselineId: string,
  candidateId: string,
): Promise<EvaluationComparison> {
  return getJson<EvaluationComparison>(
    `/api/v1/evaluations/${encodeURIComponent(baselineId)}/compare/${encodeURIComponent(candidateId)}`,
  );
}
