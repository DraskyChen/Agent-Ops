import type {
  PromptRegistryResponse,
  PromptVersionCreateRequest,
  PromptVersionDetail,
  PromptVersionSummary,
  PromptVersionUpdateRequest,
} from "@agent-ops/contracts";

import { getJson, patchJson, postJson } from "../../shared/http.js";

export async function fetchPromptRegistry(): Promise<PromptRegistryResponse> {
  return getJson<PromptRegistryResponse>("/api/v1/prompts");
}

export async function createPromptVersion(
  input: PromptVersionCreateRequest,
): Promise<PromptVersionSummary> {
  return postJson<PromptVersionSummary, PromptVersionCreateRequest>(
    "/api/v1/prompts",
    input,
  );
}

export async function fetchPromptVersion(
  promptVersion: string,
): Promise<PromptVersionDetail> {
  return getJson<PromptVersionDetail>(
    `/api/v1/prompts/${encodeURIComponent(promptVersion)}`,
  );
}

export async function updatePromptVersion(
  promptVersion: string,
  input: PromptVersionUpdateRequest,
): Promise<PromptVersionDetail> {
  return patchJson<PromptVersionDetail, PromptVersionUpdateRequest>(
    `/api/v1/prompts/${encodeURIComponent(promptVersion)}`,
    input,
  );
}
