import type { MetricsDimension } from "@agent-ops/contracts";

export type DashboardTimeRange = "24h" | "7d" | "30d";

export interface DashboardFilters {
  timeRange: DashboardTimeRange;
  environment: string;
  appName: string;
  taskType: string;
  model: string;
  promptVersion: string;
  serviceVersion: string;
}

export interface DashboardDrilldown {
  startedAfter: string;
  startedBefore: string;
  status?: string;
  hasErrors?: "true" | "false";
  environment?: string;
  appName?: string;
  taskType?: string;
  model?: string;
  promptVersion?: string;
  serviceVersion?: string;
}

export interface DashboardDimension {
  dimension: MetricsDimension;
  label: string;
}

export const DASHBOARD_FILTERS: DashboardFilters = {
  timeRange: "24h",
  environment: "all",
  appName: "",
  taskType: "",
  model: "",
  promptVersion: "",
  serviceVersion: "",
};

export const DASHBOARD_DIMENSIONS: DashboardDimension[] = [
  { dimension: "app", label: "Applications" },
  { dimension: "model", label: "Models" },
  { dimension: "taskType", label: "Tasks" },
  { dimension: "promptVersion", label: "Prompt versions" },
  { dimension: "serviceVersion", label: "Service versions" },
];
