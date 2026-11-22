import type {
  MetricsBreakdownResponse,
  MetricsDimension,
  MetricsOverviewResponse,
} from "@agent-ops/contracts";

import { getJson } from "../../shared/http.js";
import type { DashboardFilters } from "./model.js";

export async function fetchMetricsOverview(
  filters: DashboardFilters,
  startedAfter: string,
): Promise<MetricsOverviewResponse> {
  return getJson<MetricsOverviewResponse>(
    `/api/v1/metrics/overview?${metricParameters(filters, startedAfter)}`,
  );
}

export async function fetchMetricsBreakdown(
  filters: DashboardFilters,
  startedAfter: string,
  dimension: MetricsDimension,
): Promise<MetricsBreakdownResponse> {
  const params = metricParameters(filters, startedAfter);
  params.set("dimension", dimension);
  params.set("limit", "10");
  return getJson<MetricsBreakdownResponse>(
    `/api/v1/metrics/breakdown?${params.toString()}`,
  );
}

function metricParameters(
  filters: DashboardFilters,
  startedAfter: string,
): URLSearchParams {
  const params = new URLSearchParams({
    startedAfter,
    startedBefore: new Date().toISOString(),
  });
  setFilter(params, "environment", filters.environment);
  setText(params, "appName", filters.appName);
  setText(params, "taskType", filters.taskType);
  setText(params, "model", filters.model);
  setText(params, "promptVersion", filters.promptVersion);
  setText(params, "serviceVersion", filters.serviceVersion);
  return params;
}

function setText(
  params: URLSearchParams,
  name: string,
  value: string,
): void {
  const normalized = value.trim();
  if (normalized !== "") {
    params.set(name, normalized);
  }
}

function setFilter(
  params: URLSearchParams,
  name: string,
  value: string,
): void {
  if (value !== "all") {
    params.set(name, value);
  }
}
