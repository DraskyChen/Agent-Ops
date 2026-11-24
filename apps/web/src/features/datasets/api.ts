import type {
  DatasetCreateRequest,
  DatasetDetail,
  DatasetRevisionCreateRequest,
  DatasetRevisionDiff,
  DatasetRevisionDetail,
  DatasetSummary,
} from "@agent-ops/contracts";

import { getJson, postJson } from "../../shared/http.js";

export async function fetchDatasets(): Promise<DatasetSummary[]> {
  return getJson<DatasetSummary[]>("/api/v1/datasets");
}

export async function fetchDataset(
  datasetId: string,
): Promise<DatasetDetail> {
  return getJson<DatasetDetail>(
    `/api/v1/datasets/${encodeURIComponent(datasetId)}`,
  );
}

export async function fetchDatasetRevision(
  datasetId: string,
  revisionId: string,
): Promise<DatasetRevisionDetail> {
  return getJson<DatasetRevisionDetail>(
    `/api/v1/datasets/${encodeURIComponent(datasetId)}/revisions/${encodeURIComponent(revisionId)}`,
  );
}

export async function fetchDatasetRevisionDiff(
  datasetId: string,
  baselineRevisionId: string,
  candidateRevisionId: string,
): Promise<DatasetRevisionDiff> {
  return getJson<DatasetRevisionDiff>(
    `/api/v1/datasets/${encodeURIComponent(datasetId)}/revisions/${encodeURIComponent(baselineRevisionId)}/diff/${encodeURIComponent(candidateRevisionId)}`,
  );
}

export async function createDataset(
  input: DatasetCreateRequest,
): Promise<DatasetSummary> {
  return postJson<DatasetSummary, DatasetCreateRequest>(
    "/api/v1/datasets",
    input,
  );
}

export async function createDatasetRevision(
  datasetId: string,
  input: DatasetRevisionCreateRequest,
): Promise<DatasetRevisionDetail> {
  return postJson<DatasetRevisionDetail, DatasetRevisionCreateRequest>(
    `/api/v1/datasets/${encodeURIComponent(datasetId)}/revisions`,
    input,
  );
}
