import type { MetricFact, MetricRollupRow } from "@agent-ops/metrics";
import type { Pool, PoolClient } from "pg";

import {
  rebuildMetricsBucket,
  type MetricsRollupStore,
  type MetricsRollupTransaction,
} from "../../application/metrics-rollup.js";

export function createPostgresMetricsRollupStore(
  pool: Pool,
): MetricsRollupStore {
  return {
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await work(createTransaction(client));
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async markFailed(bucketStart, error) {
      await pool.query(
        `update trace_metric_rollup_jobs set
          attempt_count = attempt_count + 1,
          state = case
            when attempt_count + 1 >= 5 then 'failed'
            else 'pending'
          end,
          last_error = $2,
          completed_at = case
            when attempt_count + 1 >= 5 then now()
            else null
          end
        where bucket_start = $1`,
        [bucketStart, error.message],
      );
    },

    async rebuildBucket(bucketStart) {
      return this.transaction((transaction) =>
        rebuildMetricsBucket(transaction, bucketStart),
      );
    },
  };
}

function createTransaction(client: PoolClient): MetricsRollupTransaction {
  return {
    async claimNextBucket() {
      const result = await client.query<{ bucket_start: Date }>(
        `select bucket_start
         from trace_metric_rollup_jobs
         where state = 'pending'
         order by requested_at, bucket_start
         for update skip locked
         limit 1`,
      );
      const bucket = result.rows[0]?.bucket_start;
      if (bucket === undefined) {
        return null;
      }
      await client.query(
        `update trace_metric_rollup_jobs set
          state = 'processing',
          started_at = now(),
          attempt_count = attempt_count + 1
        where bucket_start = $1`,
        [bucket],
      );
      return bucket;
    },

    async loadFacts(bucketStart) {
      const result = await client.query<MetricFactRow>(
        `select
          start_time, app_name, environment, task_type, model,
          prompt_version, service_version, run_status, duration_ms,
          ingest_state, cost_micros, input_tokens, output_tokens,
          tool_call_count, tool_error_count
        from traces
        where start_time >= $1
          and start_time < $1 + interval '1 hour'`,
        [bucketStart],
      );
      return result.rows.map(mapMetricFact);
    },

    async replaceBucket(bucketStart, rows) {
      await client.query(
        "delete from trace_metrics_hourly where bucket_start = $1",
        [bucketStart],
      );
      if (rows.length === 0) {
        return;
      }
      await client.query(
        `insert into trace_metrics_hourly (
          bucket_start, app_name, environment, task_type, model,
          prompt_version, service_version, run_status, trace_count,
          success_count, failed_count, partial_count, cancelled_count,
          timeout_count, unknown_count, cost_micros, input_tokens,
          output_tokens, tool_call_count, tool_trace_count,
          tool_error_trace_count, duration_count, latency_le_50,
          latency_le_100, latency_le_250, latency_le_500, latency_le_1000,
          latency_le_2000, latency_le_5000, latency_le_10000,
          latency_le_30000, latency_le_60000
        )
        select
          $1::timestamptz, "appName", "environment", "taskType", "model",
          "promptVersion", "serviceVersion", "runStatus", "traceCount",
          "successCount", "failedCount", "partialCount", "cancelledCount",
          "timeoutCount", "unknownCount", "costMicros", "inputTokens",
          "outputTokens", "toolCallCount", "toolTraceCount",
          "toolErrorTraceCount", "durationCount", "latencyLe50",
          "latencyLe100", "latencyLe250", "latencyLe500", "latencyLe1000",
          "latencyLe2000", "latencyLe5000", "latencyLe10000",
          "latencyLe30000", "latencyLe60000"
        from jsonb_to_recordset($2::jsonb) as metrics(
          "bucketStart" timestamptz,
          "appName" text,
          "environment" text,
          "taskType" text,
          "model" text,
          "promptVersion" text,
          "serviceVersion" text,
          "runStatus" text,
          "traceCount" bigint,
          "successCount" bigint,
          "failedCount" bigint,
          "partialCount" bigint,
          "cancelledCount" bigint,
          "timeoutCount" bigint,
          "unknownCount" bigint,
          "costMicros" bigint,
          "inputTokens" bigint,
          "outputTokens" bigint,
          "toolCallCount" bigint,
          "toolTraceCount" bigint,
          "toolErrorTraceCount" bigint,
          "durationCount" bigint,
          "latencyLe50" bigint,
          "latencyLe100" bigint,
          "latencyLe250" bigint,
          "latencyLe500" bigint,
          "latencyLe1000" bigint,
          "latencyLe2000" bigint,
          "latencyLe5000" bigint,
          "latencyLe10000" bigint,
          "latencyLe30000" bigint,
          "latencyLe60000" bigint
        )`,
        [bucketStart, JSON.stringify(rows)],
      );
    },

    async complete(bucketStart) {
      await client.query(
        `update trace_metric_rollup_jobs set
          state = 'completed',
          completed_at = now(),
          last_error = null
        where bucket_start = $1`,
        [bucketStart],
      );
    },
  };
}

interface MetricFactRow {
  start_time: Date;
  app_name: string | null;
  environment: string | null;
  task_type: string | null;
  model: string | null;
  prompt_version: string | null;
  service_version: string | null;
  run_status: string | null;
  duration_ms: string | null;
  ingest_state: string;
  cost_micros: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
  tool_call_count: number | null;
  tool_error_count: number | null;
}

function mapMetricFact(row: MetricFactRow): MetricFact {
  return {
    startTime: row.start_time,
    appName: row.app_name,
    environment: row.environment,
    taskType: row.task_type,
    model: row.model,
    promptVersion: row.prompt_version,
    serviceVersion: row.service_version,
    runStatus: row.run_status,
    durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
    ingestState: row.ingest_state,
    costMicros: row.cost_micros === null ? 0 : Number(row.cost_micros),
    inputTokens: row.input_tokens === null ? 0 : Number(row.input_tokens),
    outputTokens: row.output_tokens === null ? 0 : Number(row.output_tokens),
    toolCallCount: row.tool_call_count ?? 0,
    toolErrorCount: row.tool_error_count ?? 0,
  };
}
