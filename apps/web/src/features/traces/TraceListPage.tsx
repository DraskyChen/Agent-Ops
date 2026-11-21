import {
  Activity,
  ChevronDown,
  CircleCheck,
  CircleX,
  Gauge,
  Search,
  Timer,
} from "lucide-react";

import type { TraceView } from "./model.js";
import {
  formatCost,
  formatDuration,
  formatTime,
  Metric,
  StatusBadge,
  statusLabel,
  TypeTag,
} from "./TracePrimitives.js";
import type { TraceFilter } from "./useTraceExplorer.js";

export function TraceListPage({
  traces,
  allTraces,
  query,
  setQuery,
  statusFilter,
  setStatusFilter,
  environment,
  setEnvironment,
  onOpenTrace,
  loading,
  error,
}: {
  traces: TraceView[];
  allTraces: TraceView[];
  query: string;
  setQuery: (value: string) => void;
  statusFilter: TraceFilter;
  setStatusFilter: (value: TraceFilter) => void;
  environment: string;
  setEnvironment: (value: string) => void;
  onOpenTrace: (trace: TraceView) => void;
  loading: boolean;
  error: string | null;
}) {
  const successes = allTraces.filter((trace) => trace.status === "success").length;
  const errors = allTraces.filter((trace) => trace.status === "failed").length;
  const avgLatency = Math.round(
    allTraces.length === 0
      ? 0
      : allTraces.reduce((total, trace) => total + trace.latencyMs, 0) /
          allTraces.length,
  );
  const totalCost = allTraces.reduce(
    (total, trace) => total + trace.costMicros,
    0,
  );

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Observability</p>
          <h1>Traces</h1>
          <p>Inspect every agent run, model call, tool invocation, and failure.</p>
        </div>
      </div>

      <section className="metrics-strip" aria-label="Trace overview">
        <Metric
          icon={<Activity size={16} />}
          label="Runs"
          value={allTraces.length.toString()}
          detail="in live data"
        />
        <Metric
          icon={<CircleCheck size={16} />}
          label="Success rate"
          value={`${
            allTraces.length === 0
              ? 0
              : Math.round((successes / allTraces.length) * 100)
          }%`}
          detail={`${successes} successful`}
        />
        <Metric
          icon={<Timer size={16} />}
          label="Average latency"
          value={formatDuration(avgLatency)}
          detail={`${errors} failed runs`}
        />
        <Metric
          icon={<Gauge size={16} />}
          label="Trace cost"
          value={formatCost(totalCost)}
          detail="selected run window"
        />
      </section>

      <section className="data-panel">
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={15} />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search runs, task types, models, trace IDs…"
              aria-label="Search traces"
            />
          </label>

          <label className="select-field">
            <span>Time</span>
            <select aria-label="Time range" defaultValue="24h">
              <option value="24h">Last 24 hours</option>
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
            </select>
            <ChevronDown size={14} />
          </label>

          <label className="select-field">
            <span>Environment</span>
            <select
              aria-label="Environment filter"
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
            >
              <option value="all">All environments</option>
              <option value="prod">Production</option>
              <option value="staging">Staging</option>
            </select>
            <ChevronDown size={14} />
          </label>

          <label className="select-field">
            <span>Status</span>
            <select
              aria-label="Status filter"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as TraceFilter)
              }
            >
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="partial">Partial</option>
            </select>
            <ChevronDown size={14} />
          </label>
        </div>

        <div className="table-summary">
          <div className="filter-tabs" role="group" aria-label="Status quick filters">
            {(["all", "success", "failed", "partial"] as const).map((status) => (
              <button
                className={statusFilter === status ? "active" : ""}
                key={status}
                type="button"
                onClick={() => setStatusFilter(status)}
              >
                {status === "all" ? "All traces" : statusLabel(status)}
              </button>
            ))}
          </div>
          <span>
            {loading ? "Loading traces…" : `${traces.length} results`}
          </span>
        </div>

        {error === null ? null : (
          <div className="data-error" role="alert">
            <CircleX size={15} />
            {error}
          </div>
        )}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Run</th>
                <th>Task</th>
                <th>Model</th>
                <th>Steps</th>
                <th>Duration</th>
                <th>Cost</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((trace) => (
                <tr key={trace.id}>
                  <td>
                    <StatusBadge status={trace.status} />
                  </td>
                  <td>
                    <button
                      className="trace-name"
                      type="button"
                      onClick={() => onOpenTrace(trace)}
                    >
                      <strong>{trace.runName}</strong>
                      <code>{trace.id}</code>
                    </button>
                  </td>
                  <td>
                    <TypeTag>{trace.taskType}</TypeTag>
                  </td>
                  <td>
                    <span className="model-name">{trace.model}</span>
                  </td>
                  <td>{trace.stepCount}</td>
                  <td>{formatDuration(trace.latencyMs)}</td>
                  <td>{formatCost(trace.costMicros)}</td>
                  <td>{formatTime(trace.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!loading && traces.length === 0 ? (
            <div className="empty-result">
              <Search size={20} />
              <strong>
                {allTraces.length === 0
                  ? "No traces ingested yet"
                  : "No matching traces"}
              </strong>
              <span>
                {allTraces.length === 0
                  ? "Run the test agent to create the first live trace."
                  : "Try clearing one of the filters."}
              </span>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
