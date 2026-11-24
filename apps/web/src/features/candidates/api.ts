import type {
  TraceCandidateActionResponse,
  TraceCandidateDismissRequest,
  TraceCandidateListResponse,
} from "@agent-ops/contracts";

import { getJson, postJson } from "../../shared/http.js";

export async function fetchCandidates(): Promise<TraceCandidateListResponse> {
  return getJson<TraceCandidateListResponse>("/api/v1/candidates");
}

export async function dismissCandidate(
  traceId: string,
  input: TraceCandidateDismissRequest = {},
): Promise<TraceCandidateActionResponse> {
  return postJson<TraceCandidateActionResponse, TraceCandidateDismissRequest>(
    `/api/v1/candidates/${encodeURIComponent(traceId)}/dismiss`,
    input,
  );
}

export async function restoreCandidate(
  traceId: string,
): Promise<TraceCandidateActionResponse> {
  return postJson<TraceCandidateActionResponse, Record<string, never>>(
    `/api/v1/candidates/${encodeURIComponent(traceId)}/restore`,
    {},
  );
}
