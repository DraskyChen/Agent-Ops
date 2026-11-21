import type { IngestHealthResponse } from "@agent-ops/contracts";

import { getJson } from "../../shared/http.js";

export async function fetchIngestHealth(
  windowHours: number,
): Promise<IngestHealthResponse> {
  return getJson<IngestHealthResponse>(
    `/api/v1/operations/ingest?windowHours=${windowHours}`,
  );
}
