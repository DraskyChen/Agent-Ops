import type {
  MetricsBreakdownResponse,
  MetricsDimension,
  MetricsOverviewResponse,
} from "@agent-ops/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { HttpError } from "../../shared/http.js";
import {
  fetchMetricsBreakdown,
  fetchMetricsOverview,
} from "./api.js";
import {
  DASHBOARD_FILTERS,
  type DashboardFilters,
} from "./model.js";

export function useDashboard() {
  const [filters, setFilters] =
    useState<DashboardFilters>(DASHBOARD_FILTERS);
  const [dimension, setDimension] = useState<MetricsDimension>("app");
  const [overview, setOverview] = useState<MetricsOverviewResponse | null>(null);
  const [breakdown, setBreakdown] =
    useState<MetricsBreakdownResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const load = useCallback(
    async (activeFilters: DashboardFilters, activeDimension: MetricsDimension) => {
      const request = ++generation.current;
      const startedAfter = new Date(
        Date.now() - rangeMilliseconds(activeFilters.timeRange),
      ).toISOString();
      setLoading(true);
      try {
        const [nextOverview, nextBreakdown] = await Promise.all([
          fetchMetricsOverview(activeFilters, startedAfter),
          fetchMetricsBreakdown(
            activeFilters,
            startedAfter,
            activeDimension,
          ),
        ]);
        if (request !== generation.current) {
          return;
        }
        setOverview(nextOverview);
        setBreakdown(nextBreakdown);
        setError(null);
      } catch (loadError) {
        if (request === generation.current) {
          setError(
            loadError instanceof HttpError && loadError.status === 401
              ? "Your session expired. Sign in again."
              : loadError instanceof Error
                ? loadError.message
                : "Unable to load metrics",
          );
        }
      } finally {
        if (request === generation.current) {
          setLoading(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const timeout = window.setTimeout(
      () => void load(filters, dimension),
      hasTextFilter(filters) ? 250 : 0,
    );
    return () => window.clearTimeout(timeout);
  }, [dimension, filters, load]);

  return {
    filters,
    setFilter<Key extends keyof DashboardFilters>(
      key: Key,
      value: DashboardFilters[Key],
    ) {
      setFilters((current) => ({ ...current, [key]: value }));
    },
    dimension,
    setDimension,
    overview,
    breakdown,
    loading,
    error,
    refresh: () => load(filters, dimension),
  };
}

function hasTextFilter(filters: DashboardFilters): boolean {
  return [
    filters.appName,
    filters.taskType,
    filters.model,
    filters.promptVersion,
    filters.serviceVersion,
  ].some((value) => value.trim() !== "");
}

function rangeMilliseconds(range: DashboardFilters["timeRange"]): number {
  return range === "24h"
    ? 24 * 60 * 60 * 1000
    : range === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
}
