import type {
  SessionDetail,
  SessionListResponse,
} from "@agent-ops/contracts";

import { getJson } from "../../shared/http.js";

export async function fetchSession(sessionId: string): Promise<SessionDetail> {
  return getJson<SessionDetail>(
    `/api/v1/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function fetchSessions(search: string): Promise<SessionListResponse> {
  const params = new URLSearchParams({ limit: "100" });
  const normalized = search.trim();
  if (normalized !== "") {
    params.set("search", normalized);
  }
  return getJson<SessionListResponse>(
    `/api/v1/sessions?${params.toString()}`,
  );
}
