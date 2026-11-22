import {
  Activity,
  ChevronDown,
  CircleCheck,
  CircleX,
  Gauge,
  Search,
  Timer,
} from "lucide-react";

import type { TraceFilters, TraceView } from "./model.js";
import {
  formatCost,
  formatDuration,
  formatTime,
  Metric,
  StatusBadge,
  statusLabel,
  TypeTag,
} from "./TracePrimitives.js";

export function TraceListPage({
  traces,
  filters,
  setFilter,
  onOpenTrace,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  error,
}: {
  traces: TraceView[];
  filters: TraceFilters;
  setFilter: <Key extends keyof TraceFilters>(
    key: Key,
    value: TraceFilters[Key],
  ) => void;
  onOpenTrace: (trace: TraceView) => void;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  error: string | null;
}) {
  const successes = traces.filter((trace) => trace.status === "success").length;
  const errors = traces.filter(
    (trace) =>
      trace.status === "failed" ||
      trace.status === "timeout" ||
      trace.toolErrorCount > 0,
  ).length;
  const avgLatency = Math.round(
    traces.length === 0
      ? 0
      : traces.reduce((total, trace) => total + trace.latencyMs, 0) /
          traces.length,
  );
  const totalCost = traces.reduce(
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

      <section className="metrics-strip" aria-label="Loaded trace page overview">
        <Metric
          icon={<Activity size={16} />}
          label="Loaded runs"
          value={traces.length.toString()}
          detail="current result page"
        />
        <Metric
          icon={<CircleCheck size={16} />}
          label="Page success rate"
          value={`${
            traces.length === 0
              ? 0
              : Math.round((successes / traces.length) * 100)
          }%`}
          detail={`${successes} successful`}
        />
        <Metric
          icon={<Timer size={16} />}
          label="Page average latency"
          value={formatDuration(avgLatency)}
          detail={`${errors} runs with errors`}
        />
        <Metric
          icon={<Gauge size={16} />}
          label="Page trace cost"
          value={formatCost(totalCost)}
          detail="loaded results only"
        />
      </section>

      <section className="data-panel">
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={15} />
            <input
              type="search"
              value={filters.search}
              onChange={(event) => setFilter("search", event.target.value)}
              placeholder="Search runs, apps, task types, models, trace IDs…"
              aria-label="Search traces"
            />
          </label>

          <Select
            label="Time"
            value={filters.timeRange}
            onChange={(value) => {
              if (value !== "custom") {
                setFilter("startedAfter", undefined);
                setFilter("startedBefore", undefined);
              }
              setFilter(
                "timeRange",
                value as TraceFilters["timeRange"],
              );
            }}
            options={[
              ["24h", "Last 24 hours"],
              ["7d", "Last 7 days"],
              ["30d", "Last 30 days"],
              ...(filters.timeRange === "custom"
                ? [["custom", "Selected chart bucket"] as [string, string]]
                : []),
            ]}
          />
          <Select
            label="Environment"
            value={filters.environment}
            onChange={(value) => setFilter("environment", value)}
            options={[
              ["all", "All environments"],
              ["prod", "Production"],
              ["staging", "Staging"],
              ["dev", "Development"],
              ["test", "Test"],
            ]}
          />
          <Select
            label="Status"
            value={filters.status}
            onChange={(value) =>
              setFilter("status", value as TraceFilters["status"])
            }
            options={[
              ["all", "All statuses"],
              ["success", "Success"],
              ["failed", "Failed"],
              ["partial", "Partial"],
              ["cancelled", "Cancelled"],
              ["timeout", "Timeout"],
            ]}
          />
          <Select
            label="Review"
            value={filters.reviewStatus}
            onChange={(value) =>
              setFilter(
                "reviewStatus",
                value as TraceFilters["reviewStatus"],
              )
            }
            options={[
              ["all", "Any review"],
              ["unreviewed", "Unreviewed"],
              ["open", "Open"],
              ["resolved", "Resolved"],
              ["ignored", "Ignored"],
            ]}
          />
        </div>

        <details className="advanced-filters">
          <summary>Advanced filters</summary>
          <div className="advanced-filter-grid">
            <TextFilter
              label="Application"
              value={filters.appName}
              onChange={(value) => setFilter("appName", value)}
            />
            <TextFilter
              label="Task type"
              value={filters.taskType}
              onChange={(value) => setFilter("taskType", value)}
            />
            <TextFilter
              label="Model"
              value={filters.model}
              onChange={(value) => setFilter("model", value)}
            />
            <TextFilter
              label="Prompt version"
              value={filters.promptVersion}
              onChange={(value) => setFilter("promptVersion", value)}
            />
            <TextFilter
              label="Service version"
              value={filters.serviceVersion}
              onChange={(value) => setFilter("serviceVersion", value)}
            />
            <Select
              label="Errors"
              value={filters.hasErrors}
              onChange={(value) =>
                setFilter("hasErrors", value as TraceFilters["hasErrors"])
              }
              options={[
                ["all", "Any result"],
                ["true", "Only runs with errors"],
                ["false", "Only clean runs"],
              ]}
            />
          </div>
        </details>

        <div className="table-summary">
          <div className="filter-tabs" role="group" aria-label="Status quick filters">
            {(["all", "failed", "success", "partial"] as const).map((status) => (
              <button
                className={filters.status === status ? "active" : ""}
                key={status}
                type="button"
                onClick={() => setFilter("status", status)}
              >
                {status === "all" ? "All traces" : statusLabel(status)}
              </button>
            ))}
          </div>
          <span>{loading ? "Loading traces…" : `${traces.length} loaded`}</span>
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
                <th>Review</th>
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
                    <span className={`review-state ${trace.reviewStatus}`}>
                      {reviewLabel(trace.reviewStatus)}
                    </span>
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
              <strong>No matching traces</strong>
              <span>Try widening the time range or clearing a filter.</span>
            </div>
          ) : null}
        </div>

        {hasMore ? (
          <div className="table-pagination">
            <button
              className="button secondary compact"
              type="button"
              onClick={onLoadMore}
              disabled={loadingMore}
            >
              {loadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select
        aria-label={`${label} filter`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
      <ChevronDown size={14} />
    </label>
  );
}

function TextFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-filter">
      <span>{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`Filter ${label.toLowerCase()}`}
      />
    </label>
  );
}

function reviewLabel(status: TraceView["reviewStatus"]): string {
  switch (status) {
    case "resolved":
      return "Resolved";
    case "ignored":
      return "Ignored";
    case "open":
      return "Open";
    default:
      return "Unreviewed";
  }
}
