import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import pg from "pg";

import { createPostgresTraceReadRepository } from "../infrastructure/postgres/trace-repository.js";
import { createPool } from "../db/pool.js";

const databaseUrl = process.env.CAPACITY_TEST_DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.trim() === "") {
  throw new Error(
    "CAPACITY_TEST_DATABASE_URL is required; use a disposable migrated database",
  );
}

const spanTarget = positiveInteger(argument("--spans") ?? "1000000");
const spansPerTrace = positiveInteger(argument("--spans-per-trace") ?? "10");
const querySamples = positiveInteger(argument("--query-samples") ?? "20");
const keepData = process.argv.includes("--keep");
const traceCount = Math.ceil(spanTarget / spansPerTrace);
const runId = randomUUID().slice(0, 8);
const pool = createPool({ connectionString: databaseUrl, max: 8 });
const repository = createPostgresTraceReadRepository(pool);
const now = new Date();
const startedAfter = new Date(
  now.getTime() - 30 * 24 * 60 * 60 * 1000,
).toISOString();
const startedBefore = new Date(now.getTime() + 60_000).toISOString();

try {
  const loadStarted = performance.now();
  const traces = await pool.query(
    `insert into traces (
      trace_id, session_id, root_span_id, app_name, run_name, service_name,
      service_version, environment, task_type, prompt_version, model,
      run_status, stop_reason, first_span_at, last_span_at, start_time,
      end_time, root_ended_at, duration_ms, step_count, llm_call_count,
      tool_call_count, tool_error_count, input_tokens, output_tokens,
      cost_micros, currency, completeness, ingest_state, sealed_at
    )
    select
      'capacity-' || $1::text || '-' || value,
      'capacity-session-' || (value % 20000),
      'capacity-' || $1::text || '-' || value || '-root',
      'capacity-app-' || (value % 8),
      'capacity-run-' || value,
      'capacity-worker',
      '2.' || (value % 20),
      case when value % 5 = 0 then 'staging' else 'prod' end,
      case when value % 3 = 0 then 'support' else 'refund' end,
      'prompt-v' || (value % 12),
      case when value % 2 = 0 then 'deepseek-flash' else 'deepseek-v4-pro' end,
      case
        when value % 37 = 0 then 'failed'
        when value % 211 = 0 then 'timeout'
        when value % 17 = 0 then 'partial'
        else 'success'
      end,
      case when value % 37 = 0 then 'error' else 'final_answer' end,
      bucket, bucket + interval '9 seconds',
      bucket, bucket + interval '9 seconds',
      bucket + interval '8 seconds',
      9000 + (value % 120001),
      $3, 1, 8, 2, 1200, 400,
      (value % 900000)::bigint, 'USD', 'complete', 'sealed_complete',
      bucket + interval '3 minutes'
    from generate_series(1, $2) value
    cross join lateral (
      select $4::timestamptz
        + (
            mod(value::bigint * 104729, $5::bigint)::double precision
            * interval '1 second'
          ) as bucket
    ) times`,
    [
      runId,
      traceCount,
      spansPerTrace,
      startedAfter,
      24 * 60 * 60,
    ],
  );
  const spans = await pool.query(
    `insert into spans (
      trace_id, span_id, parent_span_id, service_name, service_version,
      environment, span_type, span_subtype, name, start_time, end_time,
      duration_ms, status, error_type, error_category, resource_attributes,
      attributes, input_tokens, output_tokens, cached_input_tokens,
      reasoning_tokens, ttft_ms, cost_micros, content_recorded,
      schema_version, received_at
    )
    select
      t.trace_id,
      case
        when span_no = 1 then t.trace_id || '-root'
        else t.trace_id || '-span-' || lpad(span_no::text, 2, '0')
      end,
      case
        when span_no = 1 then null
        else t.trace_id || '-root'
      end,
      t.service_name, t.service_version, t.environment,
      case
        when span_no = 1 then 'agent.run'
        when span_no % 5 = 0 then 'tool.call'
        else 'llm.call'
      end,
      case when span_no = 1 then null else 'load' end,
      case
        when span_no = 1 then 'capacity-agent'
        when span_no % 5 = 0 then 'lookup_order'
        else 'chat'
      end,
      t.start_time + (span_no - 1) * interval '1 second',
      t.start_time + span_no * interval '1 second' - interval '50 milliseconds',
      950 + (span_no * 31),
      case when span_no = 5 and t.run_status = 'failed' then 'ERROR' else 'OK' end,
      case when span_no = 5 and t.run_status = 'failed' then 'ToolError' else null end,
      case when span_no = 5 and t.run_status = 'failed' then 'tool' else null end,
      jsonb_build_object(
        'service.name', t.service_name,
        'agent.app.name', t.app_name,
        'deployment.environment.name', t.environment
      ),
      jsonb_build_object(
        'agent.span.type',
          case
            when span_no = 1 then 'agent.run'
            when span_no % 5 = 0 then 'tool.call'
            else 'llm.call'
          end,
        'agent.task.type', t.task_type,
        'agent.prompt.version', t.prompt_version,
        'gen_ai.request.model', t.model,
        'capacity.run_id', $1::text
      ),
      case when span_no % 5 = 0 then 0 else 120 end,
      case when span_no % 5 = 0 then 0 else 40 end,
      0, 0, 80, 25,
      'metadata_only',
      '0.1',
      t.end_time
    from traces t
    cross join generate_series(1, $2::integer) span_no
    where t.trace_id like 'capacity-' || $1::text || '-%'`,
    [runId, spansPerTrace],
  );
  const loadMs = performance.now() - loadStarted;
  const insertedSpans = spans.rowCount ?? 0;

  const listSamples: number[] = [];
  const searchSamples: number[] = [];
  const detailSamples: number[] = [];
  let sampleTraceId: string | null = null;
  for (let index = 0; index < querySamples; index += 1) {
    const listStarted = performance.now();
    const list = await repository.list({
      startedAfter,
      startedBefore,
      environment: "prod",
      limit: 200,
    });
    listSamples.push(performance.now() - listStarted);
    sampleTraceId ??= list.items[0]?.traceId ?? null;

    const searchStarted = performance.now();
    await repository.list({
      startedAfter,
      startedBefore,
      search: index % 2 === 0 ? "support" : "deepseek-flash",
      limit: 200,
    });
    searchSamples.push(performance.now() - searchStarted);
  }
  if (sampleTraceId !== null) {
    for (let index = 0; index < querySamples; index += 1) {
      const detailStarted = performance.now();
      const detail = await repository.get(sampleTraceId);
      detailSamples.push(performance.now() - detailStarted);
      if (detail === null) {
        throw new Error("Sample trace disappeared during the capacity test");
      }
    }
  }

  const plan = await pool.query<{ "QUERY PLAN": unknown }>(
    `explain (format json, buffers)
     select trace_id
     from traces
     where start_time >= $1
       and environment = 'prod'
       and app_name ilike '%capacity-app-1%'
     order by start_time desc, trace_id desc
     limit 200`,
    [startedAfter],
  );
  const databaseSize = await pool.query<{ size_bytes: string }>(
    "select pg_database_size(current_database())::text as size_bytes",
  );
  const relationSizes = await pool.query<{
    relation: string;
    size_bytes: string;
  }>(
    `select
      c.relname as relation,
      pg_total_relation_size(c.oid)::text as size_bytes
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('traces', 'spans', 'trace_metrics_hourly')
    order by pg_total_relation_size(c.oid) desc`,
  );

  process.stdout.write(
    `${JSON.stringify(
      {
        runId,
        requestedSpans: spanTarget,
        insertedTraces: traces.rowCount ?? 0,
        insertedSpans,
        spansPerTrace,
        loadMs: Math.round(loadMs),
        spansPerSecond: Math.round((insertedSpans / loadMs) * 1000),
        traceListMs: summarize(listSamples),
        broadSearchMs: summarize(searchSamples),
        traceDetailMs: summarize(detailSamples),
        databaseSizeBytes: Number(databaseSize.rows[0]?.size_bytes ?? 0),
        relationSizes: relationSizes.rows.map((row) => ({
          relation: row.relation,
          bytes: Number(row.size_bytes),
        })),
        indexPlan: plan.rows[0]?.["QUERY PLAN"] ?? null,
        retained: keepData,
      },
      null,
      2,
    )}\n`,
  );
} finally {
  if (!keepData) {
    await pool.query("delete from traces where trace_id like $1", [
      `capacity-${runId}-%`,
    ]);
  }
  await pool.end();
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer: ${value}`);
  }
  return parsed;
}

function summarize(values: number[]): {
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
} {
  if (values.length === 0) {
    return { p50Ms: 0, p95Ms: 0, maxMs: 0 };
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50Ms: rounded(percentile(sorted, 0.5)),
    p95Ms: rounded(percentile(sorted, 0.95)),
    maxMs: rounded(sorted.at(-1) ?? 0),
  };
}

function percentile(values: number[], ratio: number): number {
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.ceil(values.length * ratio) - 1),
  );
  return values[index] ?? 0;
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}
