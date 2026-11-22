import type {
  MetricsGranularity,
  MetricsStatusCounts,
} from "@agent-ops/contracts";

export const LATENCY_BOUNDS_MS = [
  50, 100, 250, 500, 1_000, 2_000, 5_000, 10_000, 30_000, 60_000,
] as const;

export const FINAL_RUN_STATUSES = new Set([
  "success",
  "failed",
  "partial",
  "cancelled",
  "timeout",
]);

export interface MetricFact {
  startTime: Date;
  appName: string | null;
  environment: string | null;
  taskType: string | null;
  model: string | null;
  promptVersion: string | null;
  serviceVersion: string | null;
  runStatus: string | null;
  durationMs: number | null;
  ingestState: string;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
  toolErrorCount: number;
}

export interface MetricRollupRow {
  bucketStart: Date;
  appName: string;
  environment: string;
  taskType: string;
  model: string;
  promptVersion: string;
  serviceVersion: string;
  runStatus: string;
  traceCount: number;
  successCount: number;
  failedCount: number;
  partialCount: number;
  cancelledCount: number;
  timeoutCount: number;
  unknownCount: number;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  toolCallCount: number;
  toolTraceCount: number;
  toolErrorTraceCount: number;
  durationCount: number;
  latencyLe50: number;
  latencyLe100: number;
  latencyLe250: number;
  latencyLe500: number;
  latencyLe1000: number;
  latencyLe2000: number;
  latencyLe5000: number;
  latencyLe10000: number;
  latencyLe30000: number;
  latencyLe60000: number;
}

export interface MetricTotals {
  traceCount: number;
  finalizedTraceCount: number;
  statusCounts: MetricsStatusCounts;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  toolTraceCount: number;
  toolErrorTraceCount: number;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
}

export function buildHourlyRollupRows(
  facts: MetricFact[],
  bucketStart: Date,
): MetricRollupRow[] {
  const groups = new Map<string, MetricRollupRow>();
  for (const fact of facts) {
    if (metricBucketStart(fact.startTime, "hour").getTime() !== bucketStart.getTime()) {
      continue;
    }
    const dimensions = {
      appName: fact.appName ?? "",
      environment: fact.environment ?? "",
      taskType: fact.taskType ?? "",
      model: fact.model ?? "",
      promptVersion: fact.promptVersion ?? "",
      serviceVersion: fact.serviceVersion ?? "",
      runStatus: normalizeStatus(fact.runStatus),
    };
    const key = Object.values(dimensions).join("\u0000");
    const row = groups.get(key) ?? {
      bucketStart,
      ...dimensions,
      ...emptyCounters(),
    };

    row.traceCount += 1;
    incrementStatus(row, dimensions.runStatus);
    row.costMicros += fact.costMicros;
    row.inputTokens += fact.inputTokens;
    row.outputTokens += fact.outputTokens;
    row.toolCallCount += fact.toolCallCount;
    if (fact.toolCallCount > 0) {
      row.toolTraceCount += 1;
      if (fact.toolErrorCount > 0) {
        row.toolErrorTraceCount += 1;
      }
    }

    if (
      fact.ingestState === "sealed_complete" &&
      fact.durationMs !== null &&
      Number.isFinite(fact.durationMs)
    ) {
      row.durationCount += 1;
      incrementLatencyBuckets(row, fact.durationMs);
    }

    groups.set(key, row);
  }
  return [...groups.values()];
}

export function aggregateRollupRows(rows: MetricRollupRow[]): MetricTotals {
  const statusCounts: MetricsStatusCounts = {
    unknown: 0,
    success: 0,
    failed: 0,
    partial: 0,
    cancelled: 0,
    timeout: 0,
  };
  const latency = zeroLatencyBuckets();
  let traceCount = 0;
  let costMicros = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let toolTraceCount = 0;
  let toolErrorTraceCount = 0;
  let durationCount = 0;

  for (const row of rows) {
    traceCount += row.traceCount;
    statusCounts.unknown += row.unknownCount;
    statusCounts.success += row.successCount;
    statusCounts.failed += row.failedCount;
    statusCounts.partial += row.partialCount;
    statusCounts.cancelled += row.cancelledCount;
    statusCounts.timeout += row.timeoutCount;
    costMicros += row.costMicros;
    inputTokens += row.inputTokens;
    outputTokens += row.outputTokens;
    toolTraceCount += row.toolTraceCount;
    toolErrorTraceCount += row.toolErrorTraceCount;
    durationCount += row.durationCount;
    const rowBuckets = [
      row.latencyLe50,
      row.latencyLe100,
      row.latencyLe250,
      row.latencyLe500,
      row.latencyLe1000,
      row.latencyLe2000,
      row.latencyLe5000,
      row.latencyLe10000,
      row.latencyLe30000,
      row.latencyLe60000,
    ];
    for (let index = 0; index < rowBuckets.length; index += 1) {
      latency[index] = (latency[index] ?? 0) + (rowBuckets[index] ?? 0);
    }
  }

  return {
    traceCount,
    finalizedTraceCount:
      statusCounts.success +
      statusCounts.failed +
      statusCounts.partial +
      statusCounts.cancelled +
      statusCounts.timeout,
    statusCounts,
    costMicros,
    inputTokens,
    outputTokens,
    toolTraceCount,
    toolErrorTraceCount,
    p50LatencyMs: estimatePercentile(latency, durationCount, 0.5),
    p95LatencyMs: estimatePercentile(latency, durationCount, 0.95),
  };
}

export function groupRowsByMetricBucket(
  rows: MetricRollupRow[],
  granularity: MetricsGranularity,
): Map<number, MetricRollupRow[]> {
  const groups = new Map<number, MetricRollupRow[]>();
  for (const row of rows) {
    const start = metricBucketStart(row.bucketStart, granularity).getTime();
    const group = groups.get(start) ?? [];
    group.push(row);
    groups.set(start, group);
  }
  return groups;
}

export function metricBucketStart(
  value: Date,
  granularity: MetricsGranularity,
): Date {
  const result = new Date(value);
  result.setUTCMinutes(0, 0, 0);
  if (granularity === "six_hour") {
    result.setUTCHours(Math.floor(result.getUTCHours() / 6) * 6);
  } else if (granularity === "day") {
    result.setUTCHours(0);
  }
  return result;
}

export function granularityForRange(
  startedAfter: Date,
  startedBefore: Date,
): MetricsGranularity {
  const hours = (startedBefore.getTime() - startedAfter.getTime()) / 3_600_000;
  return hours <= 48 ? "hour" : hours <= 240 ? "six_hour" : "day";
}

export function bucketDurationMs(granularity: MetricsGranularity): number {
  return granularity === "hour"
    ? 3_600_000
    : granularity === "six_hour"
      ? 21_600_000
      : 86_400_000;
}

function emptyCounters(): Omit<
  MetricRollupRow,
  | "bucketStart"
  | "appName"
  | "environment"
  | "taskType"
  | "model"
  | "promptVersion"
  | "serviceVersion"
  | "runStatus"
> {
  return {
    traceCount: 0,
    successCount: 0,
    failedCount: 0,
    partialCount: 0,
    cancelledCount: 0,
    timeoutCount: 0,
    unknownCount: 0,
    costMicros: 0,
    inputTokens: 0,
    outputTokens: 0,
    toolCallCount: 0,
    toolTraceCount: 0,
    toolErrorTraceCount: 0,
    durationCount: 0,
    latencyLe50: 0,
    latencyLe100: 0,
    latencyLe250: 0,
    latencyLe500: 0,
    latencyLe1000: 0,
    latencyLe2000: 0,
    latencyLe5000: 0,
    latencyLe10000: 0,
    latencyLe30000: 0,
    latencyLe60000: 0,
  };
}

function incrementStatus(row: MetricRollupRow, status: string): void {
  switch (status) {
    case "success":
      row.successCount += 1;
      break;
    case "failed":
      row.failedCount += 1;
      break;
    case "partial":
      row.partialCount += 1;
      break;
    case "cancelled":
      row.cancelledCount += 1;
      break;
    case "timeout":
      row.timeoutCount += 1;
      break;
    default:
      row.unknownCount += 1;
  }
}

function incrementLatencyBuckets(row: MetricRollupRow, durationMs: number): void {
  row.latencyLe50 += durationMs <= 50 ? 1 : 0;
  row.latencyLe100 += durationMs <= 100 ? 1 : 0;
  row.latencyLe250 += durationMs <= 250 ? 1 : 0;
  row.latencyLe500 += durationMs <= 500 ? 1 : 0;
  row.latencyLe1000 += durationMs <= 1_000 ? 1 : 0;
  row.latencyLe2000 += durationMs <= 2_000 ? 1 : 0;
  row.latencyLe5000 += durationMs <= 5_000 ? 1 : 0;
  row.latencyLe10000 += durationMs <= 10_000 ? 1 : 0;
  row.latencyLe30000 += durationMs <= 30_000 ? 1 : 0;
  row.latencyLe60000 += durationMs <= 60_000 ? 1 : 0;
}

function estimatePercentile(
  cumulative: number[],
  count: number,
  percentile: number,
): number | null {
  if (count === 0) {
    return null;
  }
  const target = count * percentile;
  let previousCount = 0;
  let previousBound = 0;
  for (let index = 0; index < cumulative.length; index += 1) {
    const currentCount = cumulative[index] ?? 0;
    const currentBound = LATENCY_BOUNDS_MS[index] ?? 60_000;
    if (currentCount >= target) {
      const bucketCount = currentCount - previousCount;
      if (bucketCount <= 0) {
        return previousBound;
      }
      const position = (target - previousCount) / bucketCount;
      return Math.round(
        previousBound + position * (currentBound - previousBound),
      );
    }
    previousCount = currentCount;
    previousBound = currentBound;
  }
  return 60_000;
}

function zeroLatencyBuckets(): number[] {
  return Array.from({ length: LATENCY_BOUNDS_MS.length }, () => 0);
}

function normalizeStatus(value: string | null): string {
  return value !== null && FINAL_RUN_STATUSES.has(value) ? value : "unknown";
}
