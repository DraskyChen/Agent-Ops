import type {
  MetricsBreakdownQuery,
  MetricsBreakdownResponse,
  MetricsBreakdownRow,
  MetricsDimension,
  MetricsGranularity,
  MetricsOverviewResponse,
  MetricsPoint,
  MetricsQuery,
  MetricsSummary,
} from "@agent-ops/contracts";
import {
  aggregateRollupRows,
  bucketDurationMs,
  granularityForRange,
  groupRowsByMetricBucket,
  metricBucketStart,
  type MetricRollupRow,
} from "@agent-ops/metrics";

export interface NormalizedMetricsQuery {
  startedAfter: Date;
  startedBefore: Date;
  environment?: string;
  appName?: string;
  taskType?: string;
  model?: string;
  promptVersion?: string;
  serviceVersion?: string;
}

export interface MetricsRollupRead {
  rows: MetricRollupRow[];
  dataThrough: Date | null;
}

export interface MetricsRepository {
  load(query: NormalizedMetricsQuery): Promise<MetricsRollupRead>;
}

export interface MetricsService {
  overview(query: MetricsQuery): Promise<MetricsOverviewResponse>;
  breakdown(query: MetricsBreakdownQuery): Promise<MetricsBreakdownResponse>;
}

export interface MetricsServiceOptions {
  now?: () => Date;
}

export class InvalidMetricsQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidMetricsQueryError";
  }
}

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;
const DIMENSIONS = new Set<MetricsDimension>([
  "app",
  "model",
  "taskType",
  "promptVersion",
  "serviceVersion",
]);

export function createMetricsService(
  repository: MetricsRepository,
  options: MetricsServiceOptions = {},
): MetricsService {
  const now = options.now ?? (() => new Date());

  return {
    async overview(query) {
      const normalized = normalizeMetricsQuery(query, now());
      const data = await repository.load(normalized);
      const granularity = granularityForRange(
        normalized.startedAfter,
        normalized.startedBefore,
      );
      const series = buildSeries(data.rows, granularity);
      return {
        scope: {
          startedAfter: normalized.startedAfter.toISOString(),
          startedBefore: normalized.startedBefore.toISOString(),
          granularity,
          generatedAt: now().toISOString(),
          dataThrough: data.dataThrough?.toISOString() ?? null,
        },
        summary: summaryFromRows(data.rows),
        series,
      };
    },

    async breakdown(query) {
      const normalized = normalizeMetricsQuery(query, now());
      const dimension = normalizeDimension(query.dimension);
      const limit = normalizeLimit(query.limit);
      const data = await repository.load(normalized);
      const granularity = granularityForRange(
        normalized.startedAfter,
        normalized.startedBefore,
      );
      const total = aggregateRollupRows(data.rows);
      const groups = new Map<string, MetricRollupRow[]>();
      for (const row of data.rows) {
        const value = dimensionValue(row, dimension);
        const group = groups.get(value) ?? [];
        group.push(row);
        groups.set(value, group);
      }
      const items: MetricsBreakdownRow[] = [...groups.entries()]
        .map(([value, rows]) => {
          const totals = aggregateRollupRows(rows);
          return {
            value,
            traceCount: totals.traceCount,
            costMicros: totals.costMicros,
            p50LatencyMs: totals.p50LatencyMs,
            p95LatencyMs: totals.p95LatencyMs,
            toolErrorRate: ratio(
              totals.toolErrorTraceCount,
              totals.toolTraceCount,
            ),
            traceShare:
              total.traceCount === 0
                ? 0
                : totals.traceCount / total.traceCount,
          };
        })
        .sort(
          (left, right) =>
            right.traceCount - left.traceCount ||
            right.costMicros - left.costMicros ||
            left.value.localeCompare(right.value),
        )
        .slice(0, limit);

      return {
        scope: {
          startedAfter: normalized.startedAfter.toISOString(),
          startedBefore: normalized.startedBefore.toISOString(),
          granularity,
          generatedAt: now().toISOString(),
          dataThrough: data.dataThrough?.toISOString() ?? null,
        },
        dimension,
        items,
      };
    },
  };
}

export function normalizeMetricsQuery(
  query: MetricsQuery,
  now: Date,
): NormalizedMetricsQuery {
  const startedBefore =
    parseDate(query.startedBefore, "startedBefore") ?? now;
  const startedAfter =
    parseDate(query.startedAfter, "startedAfter") ??
    new Date(startedBefore.getTime() - DEFAULT_RANGE_MS);
  if (startedBefore <= startedAfter) {
    throw new InvalidMetricsQueryError(
      "startedBefore must be later than startedAfter",
    );
  }
  if (startedBefore.getTime() - startedAfter.getTime() > MAX_RANGE_MS) {
    throw new InvalidMetricsQueryError("Metrics range cannot exceed 31 days");
  }

  return {
    startedAfter: floorHour(startedAfter),
    startedBefore: ceilHour(startedBefore),
    ...optionalEntry("environment", optionalFilter(query.environment)),
    ...optionalEntry("appName", optionalText(query.appName)),
    ...optionalEntry("taskType", optionalFilter(query.taskType)),
    ...optionalEntry("model", optionalText(query.model)),
    ...optionalEntry("promptVersion", optionalText(query.promptVersion)),
    ...optionalEntry("serviceVersion", optionalText(query.serviceVersion)),
  };
}

function buildSeries(
  rows: MetricRollupRow[],
  granularity: MetricsGranularity,
): MetricsPoint[] {
  const grouped = groupRowsByMetricBucket(rows, granularity);
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucketStartMs, bucketRows]) => {
      const bucketStart = new Date(bucketStartMs);
      return {
        ...summaryFromRows(bucketRows),
        bucketStart: bucketStart.toISOString(),
        bucketEnd: new Date(
          bucketStartMs + bucketDurationMs(granularity),
        ).toISOString(),
      };
    });
}

function summaryFromRows(rows: MetricRollupRow[]): MetricsSummary {
  const totals = aggregateRollupRows(rows);
  return {
    traceCount: totals.traceCount,
    finalizedTraceCount: totals.finalizedTraceCount,
    statusCounts: totals.statusCounts,
    successRate: ratio(
      totals.statusCounts.success,
      totals.finalizedTraceCount,
    ),
    failureRate: ratio(
      totals.statusCounts.failed,
      totals.finalizedTraceCount,
    ),
    costMicros: totals.costMicros,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    toolErrorRate: ratio(
      totals.toolErrorTraceCount,
      totals.toolTraceCount,
    ),
    p50LatencyMs: totals.p50LatencyMs,
    p95LatencyMs: totals.p95LatencyMs,
    estimatedPercentiles: true,
  };
}

function dimensionValue(
  row: MetricRollupRow,
  dimension: MetricsDimension,
): string {
  const value =
    dimension === "app"
      ? row.appName
      : dimension === "model"
        ? row.model
        : dimension === "taskType"
          ? row.taskType
          : dimension === "promptVersion"
            ? row.promptVersion
            : row.serviceVersion;
  return value === "" ? "unknown" : value;
}

function normalizeDimension(value: string | undefined): MetricsDimension {
  const dimension = optionalText(value) ?? "app";
  if (!DIMENSIONS.has(dimension as MetricsDimension)) {
    throw new InvalidMetricsQueryError("Invalid metrics dimension");
  }
  return dimension as MetricsDimension;
}

function normalizeLimit(value: number | undefined): number {
  const parsed = Number(value ?? 10);
  if (!Number.isFinite(parsed)) {
    return 10;
  }
  return Math.min(Math.max(Math.trunc(parsed), 1), 50);
}

function parseDate(value: string | undefined, name: string): Date | undefined {
  const normalized = optionalText(value);
  if (normalized === undefined) {
    return undefined;
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidMetricsQueryError(`${name} must be an ISO timestamp`);
  }
  return date;
}

function floorHour(value: Date): Date {
  return metricBucketStart(value, "hour");
}

function ceilHour(value: Date): Date {
  const floor = floorHour(value);
  return floor.getTime() === value.getTime()
    ? value
    : new Date(floor.getTime() + 60 * 60 * 1000);
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? undefined : normalized;
}

function optionalFilter(value: string | undefined): string | undefined {
  return value === undefined || value === "" || value === "all"
    ? undefined
    : value;
}

function optionalEntry<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}
