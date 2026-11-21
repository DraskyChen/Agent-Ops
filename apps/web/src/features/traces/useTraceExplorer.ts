import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchTraceDetail, fetchTraces } from "./api.js";
import type {
  InspectorTab,
  TraceStatus,
  TraceView,
} from "./model.js";

export type TraceFilter = "all" | TraceStatus;

export function useTraceExplorer() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<TraceFilter>("all");
  const [environment, setEnvironment] = useState("all");
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("input");
  const [traces, setTraces] = useState<TraceView[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<TraceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadTraces = useCallback(async () => {
    setLoading(true);
    try {
      setTraces(await fetchTraces());
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Unable to load traces",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTraces();
  }, [loadTraces]);

  const filteredTraces = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return traces.filter((trace) => {
      const statusMatch =
        statusFilter === "all" || trace.status === statusFilter;
      const environmentMatch =
        environment === "all" || trace.environment === environment;
      const queryMatch =
        normalized.length === 0 ||
        [
          trace.runName,
          trace.id,
          trace.taskType,
          trace.model,
          trace.sessionId,
        ].some((value) => value.toLowerCase().includes(normalized));
      return statusMatch && environmentMatch && queryMatch;
    });
  }, [environment, query, statusFilter, traces]);

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
      const detail = await fetchTraceDetail(trace.id);
      setSelectedTrace(detail);
      setSelectedSpanId(
        detail.spans.find((span) => span.type === "llm")?.id ??
          detail.spans[0]?.id ??
          null,
      );
      setInspectorTab("input");
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Unable to load trace detail",
      );
      setSelectedTraceId(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const closeTrace = () => {
    setSelectedTraceId(null);
    setSelectedTrace(null);
    setSelectedSpanId(null);
    setDetailLoading(false);
  };

  return {
    query,
    setQuery,
    statusFilter,
    setStatusFilter,
    environment,
    setEnvironment,
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
    filteredTraces,
    loading,
    detailLoading,
    loadError,
    loadTraces,
    openTrace,
    closeTrace,
  };
}
