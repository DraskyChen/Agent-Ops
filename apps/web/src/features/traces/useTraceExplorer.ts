import type { MeResponse } from "@agent-ops/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { HttpError } from "../../shared/http.js";
import {
  fetchMe,
  fetchTraceDetail,
  fetchTraces,
  submitTraceReview,
} from "./api.js";
import {
  DEFAULT_FILTERS,
  type InspectorTab,
  type ReviewInput,
  type TraceFilters,
  type TraceView,
} from "./model.js";

export function useTraceExplorer() {
  const [filters, setFilters] = useState<TraceFilters>(DEFAULT_FILTERS);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("input");
  const [traces, setTraces] = useState<TraceView[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<TraceView | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestGeneration = useRef(0);
  const windowStartedAfter = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchMe()
      .then((principal) => {
        if (active) {
          setMe(principal);
        }
      })
      .catch(() => {
        if (active) {
          setMe(null);
        }
      })
      .finally(() => {
        if (active) {
          setAuthLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const loadFirstPage = useCallback(async (activeFilters: TraceFilters) => {
    const generation = ++requestGeneration.current;
    const startedAfter = new Date(
      Date.now() - rangeMilliseconds(activeFilters.timeRange),
    ).toISOString();
    windowStartedAfter.current = startedAfter;
    setLoading(true);
    try {
      const page = await fetchTraces(activeFilters, null, startedAfter);
      if (generation !== requestGeneration.current) {
        return;
      }
      setTraces(page.items);
      setNextCursor(page.nextCursor);
      setLoadError(null);
    } catch (error) {
      if (generation === requestGeneration.current) {
        expireSession(setMe, error);
        setLoadError(errorMessage(error, "Unable to load traces"));
      }
    } finally {
      if (generation === requestGeneration.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (authLoading || me === null) {
      return;
    }
    const timeout = window.setTimeout(
      () => void loadFirstPage(filters),
      filters.search === "" ? 0 : 250,
    );
    return () => window.clearTimeout(timeout);
  }, [authLoading, filters, loadFirstPage, me]);

  const selectedSpan =
    selectedTrace?.spans.find((span) => span.id === selectedSpanId) ??
    selectedTrace?.spans[0] ??
    null;

  const openTrace = async (trace: TraceView) => {
    setSelectedTraceId(trace.id);
    setSelectedTrace(null);
    setSelectedSpanId(null);
    setDetailLoading(true);
    setLoadError(null);
    try {
      const detail = await fetchTraceDetail(
        trace.id,
        me?.canViewContent ?? false,
      );
      setSelectedTrace(detail);
      setSelectedSpanId(
        detail.spans.find((span) => span.type === "llm")?.id ??
          detail.spans[0]?.id ??
          null,
      );
      setInspectorTab("input");
    } catch (error) {
      expireSession(setMe, error);
      setLoadError(errorMessage(error, "Unable to load trace detail"));
      setSelectedTraceId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const loadMore = async () => {
    if (nextCursor === null || loadingMore) {
      return;
    }
    setLoadingMore(true);
    try {
      const page = await fetchTraces(
        filters,
        nextCursor,
        windowStartedAfter.current ?? undefined,
      );
      setTraces((current) => [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setLoadError(null);
    } catch (error) {
      expireSession(setMe, error);
      setLoadError(errorMessage(error, "Unable to load more traces"));
    } finally {
      setLoadingMore(false);
    }
  };

  const submitReview = async (input: ReviewInput) => {
    if (selectedTraceId === null) {
      return;
    }
    setReviewSubmitting(true);
    try {
      await submitTraceReview(selectedTraceId, input);
      const detail = await fetchTraceDetail(
        selectedTraceId,
        me?.canViewContent ?? false,
      );
      setSelectedTrace(detail);
      await loadFirstPage(filters);
    } catch (error) {
      expireSession(setMe, error);
      setLoadError(errorMessage(error, "Unable to save review"));
    } finally {
      setReviewSubmitting(false);
    }
  };

  const closeTrace = () => {
    setSelectedTraceId(null);
    setSelectedTrace(null);
    setSelectedSpanId(null);
    setDetailLoading(false);
  };

  return {
    filters,
    setFilter<Key extends keyof TraceFilters>(
      key: Key,
      value: TraceFilters[Key],
    ) {
      setFilters((current) => ({ ...current, [key]: value }));
    },
    me,
    authLoading,
    selectedTraceId,
    selectedTrace,
    selectedSpan,
    inspectorTab,
    setInspectorTab,
    selectSpan(spanId: string) {
      setSelectedSpanId(spanId);
      setInspectorTab("input");
    },
    traces,
    nextCursor,
    loading,
    loadingMore,
    detailLoading,
    reviewSubmitting,
    loadError,
    refresh: () => loadFirstPage(filters),
    loadMore,
    submitReview,
    openTrace,
    closeTrace,
  };
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof HttpError && error.status === 401) {
    return "Sign in to access Agent Ops.";
  }
  return error instanceof Error ? error.message : fallback;
}

function expireSession(
  setMe: (principal: MeResponse | null) => void,
  error: unknown,
): void {
  if (error instanceof HttpError && error.status === 401) {
    setMe(null);
  }
}

function rangeMilliseconds(range: TraceFilters["timeRange"]): number {
  return range === "24h"
    ? 24 * 60 * 60 * 1000
    : range === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
}
