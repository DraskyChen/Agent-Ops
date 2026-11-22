import type { Pool } from "pg";

import type {
  MetricsRepository,
  NormalizedMetricsQuery,
} from "../../application/metrics.js";
import type { MetricRollupRow } from "@agent-ops/metrics";

export function createPostgresMetricsRepository(
  pool: Pool,
): MetricsRepository {
  return {
    async load(query) {
      const conditions = [
        "bucket_start >= $1",
        "bucket_start < $2",
      ];
      const values: unknown[] = [query.startedAfter, query.startedBefore];
      addFilter(conditions, values, "environment", query.environment);
      addFilter(conditions, values, "app_name", query.appName);
      addFilter(conditions, values, "task_type", query.taskType);
      addFilter(conditions, values, "model", query.model);
      addFilter(conditions, values, "prompt_version", query.promptVersion);
      addFilter(conditions, values, "service_version", query.serviceVersion);

      const [result, freshness] = await Promise.all([
        pool.query<MetricRow>(
          `select
            bucket_start, app_name, environment, task_type, model,
            prompt_version, service_version, run_status, trace_count,
            success_count, failed_count, partial_count, cancelled_count,
            timeout_count, unknown_count, cost_micros, input_tokens,
            output_tokens, tool_call_count, tool_trace_count,
            tool_error_trace_count, duration_count, latency_le_50,
            latency_le_100, latency_le_250, latency_le_500, latency_le_1000,
            latency_le_2000, latency_le_5000, latency_le_10000,
            latency_le_30000, latency_le_60000
          from trace_metrics_hourly
          where ${conditions.join(" and ")}
          order by bucket_start asc`,
          values,
        ),
        pool.query<{ latest_bucket: Date | null }>(
          `select max(bucket_start) as latest_bucket
           from trace_metrics_hourly
           where bucket_start >= $1 and bucket_start < $2`,
          [query.startedAfter, query.startedBefore],
        ),
      ]);

      return {
        rows: result.rows.map(mapMetricRow),
        dataThrough:
          freshness.rows[0]?.latest_bucket === null ||
          freshness.rows[0]?.latest_bucket === undefined
            ? null
            : new Date(
                freshness.rows[0].latest_bucket.getTime() +
                  60 * 60 * 1000,
              ),
      };
    },
  };
}

interface MetricRow {
  bucket_start: Date;
  app_name: string;
  environment: string;
  task_type: string;
  model: string;
  prompt_version: string;
  service_version: string;
  run_status: string;
  trace_count: string;
  success_count: string;
  failed_count: string;
  partial_count: string;
  cancelled_count: string;
  timeout_count: string;
  unknown_count: string;
  cost_micros: string;
  input_tokens: string;
  output_tokens: string;
  tool_call_count: string;
  tool_trace_count: string;
  tool_error_trace_count: string;
  duration_count: string;
  latency_le_50: string;
  latency_le_100: string;
  latency_le_250: string;
  latency_le_500: string;
  latency_le_1000: string;
  latency_le_2000: string;
  latency_le_5000: string;
  latency_le_10000: string;
  latency_le_30000: string;
  latency_le_60000: string;
}

function mapMetricRow(row: MetricRow): MetricRollupRow {
  return {
    bucketStart: row.bucket_start,
    appName: row.app_name,
    environment: row.environment,
    taskType: row.task_type,
    model: row.model,
    promptVersion: row.prompt_version,
    serviceVersion: row.service_version,
    runStatus: row.run_status,
    traceCount: Number(row.trace_count),
    successCount: Number(row.success_count),
    failedCount: Number(row.failed_count),
    partialCount: Number(row.partial_count),
    cancelledCount: Number(row.cancelled_count),
    timeoutCount: Number(row.timeout_count),
    unknownCount: Number(row.unknown_count),
    costMicros: Number(row.cost_micros),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    toolCallCount: Number(row.tool_call_count),
    toolTraceCount: Number(row.tool_trace_count),
    toolErrorTraceCount: Number(row.tool_error_trace_count),
    durationCount: Number(row.duration_count),
    latencyLe50: Number(row.latency_le_50),
    latencyLe100: Number(row.latency_le_100),
    latencyLe250: Number(row.latency_le_250),
    latencyLe500: Number(row.latency_le_500),
    latencyLe1000: Number(row.latency_le_1000),
    latencyLe2000: Number(row.latency_le_2000),
    latencyLe5000: Number(row.latency_le_5000),
    latencyLe10000: Number(row.latency_le_10000),
    latencyLe30000: Number(row.latency_le_30000),
    latencyLe60000: Number(row.latency_le_60000),
  };
}

function addFilter(
  conditions: string[],
  values: unknown[],
  column: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    return;
  }
  values.push(value);
  conditions.push(`${column} = $${values.length}`);
}
