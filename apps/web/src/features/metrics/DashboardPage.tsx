import {
  Activity,
  CircleCheck,
  CircleX,
  Clock3,
  Gauge,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { useState } from "react";

import type {
  MetricsDimension,
  MetricsOverviewResponse,
  MetricsPoint,
  MetricsSummary,
} from "@agent-ops/contracts";

import {
  formatCost,
  formatDuration,
  Metric,
} from "../traces/TracePrimitives.js";
import {
  DASHBOARD_DIMENSIONS,
  type DashboardDrilldown,
  type DashboardFilters,
} from "./model.js";
import { useDashboard } from "./useDashboard.js";

export function DashboardPage({
  onDrilldown,
}: {
  onDrilldown: (drilldown: DashboardDrilldown) => void;
}) {
  const dashboard = useDashboard();
  const overview = dashboard.overview;
  const summary = overview?.summary;

  return (
    <div className="page dashboard-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Analytics</p>
          <h1>Dashboards</h1>
          <p>
            Cost, quality signals, latency, and failures across every agent run.
          </p>
        </div>
        <button
          className="button secondary compact"
          type="button"
          onClick={() => void dashboard.refresh()}
          disabled={dashboard.loading}
        >
          <RefreshCw size={14} />
          {dashboard.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <DashboardFiltersBar
        filters={dashboard.filters}
        setFilter={dashboard.setFilter}
      />

      {dashboard.error === null ? null : (
        <div className="data-error" role="alert">
          <CircleX size={15} />
          {dashboard.error}
        </div>
      )}

      {summary === undefined ? (
        <div className="detail-loading">Loading operational metrics…</div>
      ) : (
        <>
          <section className="metrics-strip dashboard-kpis">
            <Metric
              icon={<Activity size={16} />}
              label="Trace volume"
              value={summary.traceCount.toLocaleString()}
              detail={`${summary.finalizedTraceCount.toLocaleString()} finalized`}
            />
            <Metric
              icon={<CircleCheck size={16} />}
              label="Success rate"
              value={formatPercent(summary.successRate)}
              detail={`${summary.statusCounts.failed} failed · ${summary.statusCounts.timeout} timeout`}
            />
            <Metric
              icon={<Gauge size={16} />}
              label="Trace cost"
              value={formatCost(summary.costMicros)}
              detail={`${summary.inputTokens.toLocaleString()} in · ${summary.outputTokens.toLocaleString()} out`}
            />
            <Metric
              icon={<Clock3 size={16} />}
              label="P95 latency"
              value={
                summary.p95LatencyMs === null
                  ? "—"
                  : `~${formatDuration(summary.p95LatencyMs)}`
              }
              detail="estimated · sealed complete"
            />
            <Metric
              icon={<Wrench size={16} />}
              label="Tool error rate"
              value={formatPercent(summary.toolErrorRate)}
              detail="runs with tool calls"
            />
          </section>

          {overview === null ? null : (
            <DashboardCharts
              overview={overview}
              filters={dashboard.filters}
              onDrilldown={onDrilldown}
            />
          )}

          <BreakdownPanel
            dimension={dashboard.dimension}
            setDimension={dashboard.setDimension}
            filters={dashboard.filters}
            overview={overview}
            items={dashboard.breakdown?.items ?? []}
            onDrilldown={onDrilldown}
          />

          <div className="metrics-freshness">
            <span>
              Data through{" "}
              {overview?.scope.dataThrough === null ||
              overview?.scope.dataThrough === undefined
                ? "no rollups yet"
                : formatTimestamp(overview.scope.dataThrough)}
            </span>
            <span>
              Generated {formatTimestamp(overview?.scope.generatedAt)}
            </span>
            <span>Percentiles are estimated from latency histograms.</span>
          </div>
        </>
      )}
    </div>
  );
}

function DashboardFiltersBar({
  filters,
  setFilter,
}: {
  filters: DashboardFilters;
  setFilter: <Key extends keyof DashboardFilters>(
    key: Key,
    value: DashboardFilters[Key],
  ) => void;
}) {
  return (
    <section className="dashboard-filters">
      <Select
        label="Time"
        value={filters.timeRange}
        onChange={(value) =>
          setFilter("timeRange", value as DashboardFilters["timeRange"])
        }
        options={[
          ["24h", "Last 24 hours"],
          ["7d", "Last 7 days"],
          ["30d", "Last 30 days"],
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
      <TextFilter
        label="Application"
        value={filters.appName}
        onChange={(value) => setFilter("appName", value)}
      />
      <TextFilter
        label="Model"
        value={filters.model}
        onChange={(value) => setFilter("model", value)}
      />
      <TextFilter
        label="Task"
        value={filters.taskType}
        onChange={(value) => setFilter("taskType", value)}
      />
      <TextFilter
        label="Prompt"
        value={filters.promptVersion}
        onChange={(value) => setFilter("promptVersion", value)}
      />
      <TextFilter
        label="Service version"
        value={filters.serviceVersion}
        onChange={(value) => setFilter("serviceVersion", value)}
      />
    </section>
  );
}

function DashboardCharts({
  overview,
  filters,
  onDrilldown,
}: {
  overview: MetricsOverviewResponse;
  filters: DashboardFilters;
  onDrilldown: (drilldown: DashboardDrilldown) => void;
}) {
  const series = overview.series;
  return (
    <section className="dashboard-chart-grid">
      <article className="dashboard-chart status-volume">
        <ChartHeading
          title="Trace volume"
          detail={`${overview.scope.granularity.replace("_", " ")} buckets`}
        />
        <StatusVolumeChart
          series={series}
          granularity={overview.scope.granularity}
          onSelect={(point, status) =>
            onDrilldown(
              drilldownForRange(filters, point.bucketStart, point.bucketEnd, {
                status,
              }),
            )
          }
        />
        <Legend
          items={[
            ["success", "Success"],
            ["failed", "Failed"],
            ["other", "Other"],
          ]}
        />
      </article>

      <article className="dashboard-chart">
        <ChartHeading title="Cost" detail="trace projection total" />
        <LineChart
          series={[
            {
              label: "Cost",
              color: "var(--data-primary)",
              values: series.map((point) => point.costMicros),
              format: formatCost,
            },
          ]}
          labels={series.map((point) => point.bucketStart)}
          granularity={overview.scope.granularity}
          yAxisLabel="USD"
          onSelect={(index) => {
            const point = series[index];
            if (point !== undefined) {
              onDrilldown(
                drilldownForRange(filters, point.bucketStart, point.bucketEnd),
              );
            }
          }}
        />
      </article>

      <article className="dashboard-chart">
        <ChartHeading title="Latency" detail="estimated P50 / P95" />
        <LineChart
          series={[
            {
              label: "P50",
              color: "var(--success)",
              values: series.map((point) => point.p50LatencyMs),
              format: formatDuration,
            },
            {
              label: "P95",
              color: "var(--warning, #bd7b00)",
              values: series.map((point) => point.p95LatencyMs),
              format: formatDuration,
            },
          ]}
          labels={series.map((point) => point.bucketStart)}
          granularity={overview.scope.granularity}
          yAxisLabel="Latency"
          onSelect={(index) => {
            const point = series[index];
            if (point !== undefined) {
              onDrilldown(
                drilldownForRange(filters, point.bucketStart, point.bucketEnd),
              );
            }
          }}
        />
        <Legend
          items={[
            ["success", "P50"],
            ["warning", "P95"],
          ]}
        />
      </article>

      <article className="dashboard-chart">
        <ChartHeading title="Tool error rate" detail="runs with tool calls" />
        <LineChart
          series={[
            {
              label: "Tool errors",
              color: "var(--danger)",
              values: series.map((point) => point.toolErrorRate),
              format: formatPercent,
            },
          ]}
          labels={series.map((point) => point.bucketStart)}
          granularity={overview.scope.granularity}
          yAxisLabel="Error rate"
          maxValue={1}
          onSelect={(index) => {
            const point = series[index];
            if (point !== undefined) {
              onDrilldown(
                drilldownForRange(filters, point.bucketStart, point.bucketEnd, {
                  hasErrors: "true",
                }),
              );
            }
          }}
        />
      </article>
    </section>
  );
}

function BreakdownPanel({
  dimension,
  setDimension,
  filters,
  overview,
  items,
  onDrilldown,
}: {
  dimension: MetricsDimension;
  setDimension: (dimension: MetricsDimension) => void;
  filters: DashboardFilters;
  overview: MetricsOverviewResponse | null;
  items: Array<{
    value: string;
    traceCount: number;
    costMicros: number;
    p95LatencyMs: number | null;
    toolErrorRate: number | null;
    traceShare: number;
  }>;
  onDrilldown: (drilldown: DashboardDrilldown) => void;
}) {
  return (
    <section className="dashboard-breakdown">
      <div className="panel-heading">
        <div>
          <strong>Distribution</strong>
          <small>Top values by trace volume</small>
        </div>
        <div className="breakdown-tabs">
          {DASHBOARD_DIMENSIONS.map((item) => (
            <button
              className={dimension === item.dimension ? "active" : ""}
              key={item.dimension}
              type="button"
              onClick={() => setDimension(item.dimension)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {items.length === 0 ? (
        <p className="empty-copy">No rollup data for this range and filter.</p>
      ) : (
        <div className="breakdown-list">
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => {
                if (overview === null) {
                  return;
                }
                onDrilldown(
                  drilldownForRange(
                    filters,
                    overview.scope.startedAfter,
                    overview.scope.startedBefore,
                    dimensionFilter(dimension, item.value),
                  ),
                );
              }}
            >
              <span className="breakdown-label">
                <strong>{item.value}</strong>
                <small>
                  {formatPercent(item.toolErrorRate)} tool errors ·{" "}
                  {item.p95LatencyMs === null
                    ? "—"
                    : `${formatDuration(item.p95LatencyMs)} P95`}
                </small>
              </span>
              <span className="breakdown-value">
                <strong>{item.traceCount.toLocaleString()}</strong>
                <small>{formatCost(item.costMicros)}</small>
              </span>
              <span className="breakdown-track">
                <span style={{ width: `${item.traceShare * 100}%` }} />
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function StatusVolumeChart({
  series,
  granularity,
  onSelect,
}: {
  series: MetricsPoint[];
  granularity: MetricsOverviewResponse["scope"]["granularity"];
  onSelect: (point: MetricsPoint, status?: string) => void;
}) {
  const max = Math.max(1, ...series.map((point) => point.traceCount));
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const xTicks = sampleIndexes(series.length);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const hoveredPoint =
    hoveredIndex === null ? undefined : series[hoveredIndex];
  return (
    <div className="status-volume-frame">
      <div className="chart-y-axis" aria-hidden="true">
        {ticks.map((tick) => (
          <span key={tick}>{Math.round(max * tick)}</span>
        ))}
      </div>
      <div className="status-volume-plot">
        <div className="chart-horizontal-grid" aria-hidden="true">
          {ticks.map((tick) => (
            <span key={tick} />
          ))}
        </div>
        <div className="status-volume-chart">
          {series.map((point, index) => {
            const failed =
              point.statusCounts.failed + point.statusCounts.timeout;
            const success = point.statusCounts.success;
            const other = Math.max(0, point.traceCount - failed - success);
            return (
              <button
                key={point.bucketStart}
                type="button"
                title={`${formatTimestamp(point.bucketStart)}: ${point.traceCount} traces`}
                className={hoveredIndex === index ? "hovered" : ""}
                style={{
                  height: `${Math.max(2, (point.traceCount / max) * 100)}%`,
                }}
                onClick={() => onSelect(point)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
                onFocus={() => setHoveredIndex(index)}
                onBlur={() => setHoveredIndex(null)}
              >
                <span
                  className="failed"
                  style={{ flexGrow: failed }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(point, "failed");
                  }}
                />
                <span
                  className="success"
                  style={{ flexGrow: success }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(point, "success");
                  }}
                />
                <span className="other" style={{ flexGrow: other }} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="chart-x-axis">
        {xTicks.map((index) => {
          const point = series[index];
          return (
            <span key={index}>
              {point === undefined
                ? ""
                : formatBucketLabel(point.bucketStart, granularity)}
            </span>
          );
        })}
      </div>
      <span className="chart-axis-title">Trace count</span>
      <span className="chart-time-title">Time</span>
      {hoveredPoint === undefined || hoveredIndex === null ? null : (
        <div
          className="chart-tooltip status-tooltip"
          role="tooltip"
          style={{
            left: `${Math.min(
              78,
              Math.max(22, ((hoveredIndex + 0.5) / series.length) * 100),
            )}%`,
          }}
        >
          <strong>{formatTimestamp(hoveredPoint.bucketStart)}</strong>
          <TooltipValue
            color="var(--text)"
            label="Total"
            value={hoveredPoint.traceCount.toLocaleString()}
          />
          <TooltipValue
            color="var(--data-fill)"
            label="Success"
            value={hoveredPoint.statusCounts.success.toLocaleString()}
          />
          <TooltipValue
            color="var(--danger)"
            label="Failed"
            value={hoveredPoint.statusCounts.failed.toLocaleString()}
          />
          <TooltipValue
            color="var(--warning, #bd7b00)"
            label="Partial / other"
            value={(
              hoveredPoint.statusCounts.partial +
              hoveredPoint.statusCounts.cancelled +
              hoveredPoint.statusCounts.timeout +
              hoveredPoint.statusCounts.unknown
            ).toLocaleString()}
          />
        </div>
      )}
    </div>
  );
}

function LineChart({
  series,
  labels,
  granularity,
  yAxisLabel,
  maxValue,
  onSelect,
}: {
  series: Array<{
    label: string;
    color: string;
    values: Array<number | null>;
    format: (value: number) => string;
  }>;
  labels: string[];
  granularity: MetricsOverviewResponse["scope"]["granularity"];
  yAxisLabel: string;
  maxValue?: number;
  onSelect: (index: number) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const values = series.flatMap((item) =>
    item.values.filter((value): value is number => value !== null),
  );
  const max = maxValue ?? Math.max(1, ...values);
  const count = Math.max(1, labels.length || series[0]?.values.length || 1);
  const width = 680;
  const height = 220;
  const plotLeft = 70;
  const plotRight = 648;
  const plotTop = 14;
  const plotBottom = 174;
  const x = (index: number) =>
    plotLeft +
    (index / Math.max(1, count - 1)) * (plotRight - plotLeft);
  const y = (value: number) =>
    plotBottom -
    (value / max) * (plotBottom - plotTop);
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const xTicks = sampleIndexes(count);
  const formatter = series[0]?.format ?? ((value) => String(value));
  const active = values.length > 0;

  if (!active) {
    return <div className="chart-empty">No data in this range</div>;
  }

  return (
    <div className="line-chart-frame">
      <svg
        className="metric-line-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={series.map((item) => item.label).join(", ")}
        onMouseLeave={() => setHoveredIndex(null)}
      >
      {ticks.map((tick) => {
        const yPosition = y(max * tick);
        return (
          <g key={tick}>
            <line
              x1={plotLeft}
              x2={plotRight}
              y1={yPosition}
              y2={yPosition}
              className="chart-grid-line"
            />
            <text
              x={plotLeft - 10}
              y={yPosition + 3}
              textAnchor="end"
              className="chart-axis-label"
            >
              {formatter(max * tick)}
            </text>
          </g>
        );
      })}
      <line
        x1={plotLeft}
        x2={plotLeft}
        y1={plotTop}
        y2={plotBottom}
        className="chart-axis-line"
      />
      <line
        x1={plotLeft}
        x2={plotRight}
        y1={plotBottom}
        y2={plotBottom}
        className="chart-axis-line"
      />
      {Array.from({ length: count }, (_, index) => {
        const spacing = (plotRight - plotLeft) / Math.max(1, count - 1);
        const bandStart =
          index === 0 ? plotLeft : x(index) - spacing / 2;
        const bandEnd =
          index === count - 1 ? plotRight : x(index) + spacing / 2;
        return (
          <rect
            key={`hover-${index}`}
            x={bandStart}
            y={plotTop}
            width={Math.max(1, bandEnd - bandStart)}
            height={plotBottom - plotTop}
            fill="transparent"
            className="chart-hover-band"
            onMouseEnter={() => setHoveredIndex(index)}
            onFocus={() => setHoveredIndex(index)}
            onClick={() => onSelect(index)}
          />
        );
      })}
      {hoveredIndex === null ? null : (
        <line
          x1={x(hoveredIndex)}
          x2={x(hoveredIndex)}
          y1={plotTop}
          y2={plotBottom}
          className="chart-hover-line"
        />
      )}
      {series.map((item) => {
        const points = item.values
          .map((value, index) =>
            value === null ? null : `${x(index)},${y(value)}`,
          )
          .filter((point): point is string => point !== null)
          .join(" ");
        return (
          <g key={item.label}>
            <polyline
              points={points}
              fill="none"
              stroke={item.color}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {item.values.map((value, index) =>
              value === null ? null : (
                <g
                  key={`${item.label}-${index}`}
                  role="button"
                  tabIndex={0}
                  className="chart-point"
                  onClick={() => onSelect(index)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      onSelect(index);
                    }
                  }}
                >
                  <circle cx={x(index)} cy={y(value)} r="7" opacity="0" />
                  <circle
                    cx={x(index)}
                    cy={y(value)}
                    r={hoveredIndex === index ? "4.5" : "3"}
                    fill={item.color}
                    stroke={
                      hoveredIndex === index ? "var(--surface)" : "none"
                    }
                    strokeWidth="1.5"
                  />
                </g>
              ),
            )}
          </g>
        );
      })}
      {xTicks.map((index) => {
        const label = labels[index];
        return (
          <text
            key={index}
            x={x(index)}
            y={plotBottom + 18}
            textAnchor={
              index === 0
                ? "start"
                : index === count - 1
                  ? "end"
                  : "middle"
            }
            className="chart-axis-label"
          >
            {label === undefined
              ? ""
              : formatBucketLabel(label, granularity)}
          </text>
        );
      })}
      <text
        x="15"
        y={(plotTop + plotBottom) / 2}
        transform={`rotate(-90 15 ${(plotTop + plotBottom) / 2})`}
        textAnchor="middle"
        className="chart-axis-title"
      >
        {yAxisLabel}
      </text>
      <text
        x={plotRight}
        y="214"
        textAnchor="end"
        className="chart-axis-title"
      >
        Time
      </text>
      </svg>
      {hoveredIndex === null ? null : (
        <div
          className="chart-tooltip line-tooltip"
          role="tooltip"
          style={{
            left: `${Math.min(76, Math.max(24, (x(hoveredIndex) / width) * 100))}%`,
          }}
        >
          <strong>
            {formatBucketLabel(labels[hoveredIndex] ?? "", granularity)}
          </strong>
          {series.map((item) => (
            <TooltipValue
              key={item.label}
              color={item.color}
              label={item.label}
              value={
                item.values[hoveredIndex] === null ||
                item.values[hoveredIndex] === undefined
                  ? "—"
                  : item.format(item.values[hoveredIndex])
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TooltipValue({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <span className="chart-tooltip-value">
      <i style={{ background: color }} />
      <em>{label}</em>
      <b>{value}</b>
    </span>
  );
}

function ChartHeading({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="chart-heading">
      <strong>{title}</strong>
      <small>{detail}</small>
    </div>
  );
}

function Legend({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="chart-legend">
      {items.map(([tone, label]) => (
        <span key={tone}>
          <i className={tone} />
          {label}
        </span>
      ))}
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
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
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
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function drilldownForRange(
  filters: DashboardFilters,
  startedAfter: string,
  startedBefore: string,
  overrides: Partial<DashboardDrilldown> = {},
): DashboardDrilldown {
  return {
    startedAfter,
    startedBefore,
    ...(filters.environment === "all"
      ? {}
      : { environment: filters.environment }),
    ...optionalText("appName", filters.appName),
    ...optionalText("taskType", filters.taskType),
    ...optionalText("model", filters.model),
    ...optionalText("promptVersion", filters.promptVersion),
    ...optionalText("serviceVersion", filters.serviceVersion),
    ...overrides,
  };
}

function dimensionFilter(
  dimension: MetricsDimension,
  value: string,
): Partial<DashboardDrilldown> {
  switch (dimension) {
    case "app":
      return { appName: value };
    case "model":
      return { model: value };
    case "taskType":
      return { taskType: value };
    case "promptVersion":
      return { promptVersion: value };
    case "serviceVersion":
      return { serviceVersion: value };
  }
}

function optionalText<Key extends string>(
  key: Key,
  value: string,
): Partial<Record<Key, string>> {
  const normalized = value.trim();
  return normalized === "" ? {} : ({ [key]: normalized } as Record<Key, string>);
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 1000) / 10}%`;
}

function formatTimestamp(value: string | undefined): string {
  if (value === undefined) {
    return "—";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function formatBucketLabel(
  value: string,
  granularity: MetricsOverviewResponse["scope"]["granularity"],
): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    ...(granularity === "day"
      ? {}
      : {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }),
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

function sampleIndexes(length: number): number[] {
  if (length <= 1) {
    return [0];
  }
  if (length === 2) {
    return [0, 1];
  }
  if (length === 3) {
    return [0, 1, 2];
  }
  return [
    0,
    Math.round((length - 1) / 3),
    Math.round(((length - 1) * 2) / 3),
    length - 1,
  ].filter((value, index, values) => values.indexOf(value) === index);
}
