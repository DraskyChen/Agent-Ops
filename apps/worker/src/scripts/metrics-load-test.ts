import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";

import pg from "pg";

import { createPostgresMetricsRollupStore } from "../infrastructure/postgres/metrics-rollup-store.js";

const databaseUrl = process.env.METRICS_LOAD_TEST_DATABASE_URL;
if (databaseUrl === undefined) {
  throw new Error(
    "METRICS_LOAD_TEST_DATABASE_URL is required; use a disposable database",
  );
}

const traceCount = positiveInteger(argument("--traces") ?? "100000");
const apiUrl = process.env.METRICS_LOAD_TEST_API_URL ?? "http://127.0.0.1:4318";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
const runId = randomUUID().slice(0, 8);

try {
  const now = new Date();
  const startedAfter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const insertStarted = performance.now();
  await pool.query(
    `insert into traces (
      trace_id, app_name, run_name, service_version, environment,
      task_type, prompt_version, model, run_status, first_span_at,
      last_span_at, start_time, end_time, duration_ms, step_count,
      llm_call_count, tool_call_count, tool_error_count, input_tokens,
      output_tokens, cost_micros, currency, completeness, ingest_state,
      sealed_at
    )
    select
      'load-' || $1 || '-' || value,
      'load-app-' || (value % 5),
      'load-run-' || value,
      '1.' || (value % 10),
      case when value % 4 = 0 then 'staging' else 'prod' end,
      case when value % 3 = 0 then 'support' else 'refund' end,
      'prompt-v' || (value % 7),
      case when value % 2 = 0 then 'deepseek-flash' else 'deepseek-v4-pro' end,
      case
        when value % 20 = 0 then 'failed'
        when value % 97 = 0 then 'timeout'
        when value % 11 = 0 then 'partial'
        else 'success'
      end,
      bucket, bucket, bucket, bucket,
      50 + ((value * 7919) % 120000),
      1 + (value % 8),
      value % 4,
      case when value % 4 = 0 then 2 else 0 end,
      case when value % 4 = 0 and value % 5 = 0 then 1 else 0 end,
      value % 3000,
      value % 1000,
      (value % 500000)::bigint,
      'USD',
      'complete',
      'sealed_complete',
      bucket
    from generate_series(1, $2) value
    cross join lateral (
      select $3::timestamptz
        + ((value * 7919) % 2592000) * interval '1 second' as bucket
    ) times`,
    [runId, traceCount, startedAfter],
  );
  const insertMs = performance.now() - insertStarted;

  const store = createPostgresMetricsRollupStore(pool);
  const backfillStarted = performance.now();
  const first = new Date(startedAfter);
  first.setUTCMinutes(0, 0, 0);
  for (
    let cursor = first;
    cursor <= now;
    cursor = new Date(cursor.getTime() + 60 * 60 * 1000)
  ) {
    await store.rebuildBucket(cursor);
  }
  const backfillMs = performance.now() - backfillStarted;

  const queryStarted = performance.now();
  const [overview, breakdown] = await Promise.all([
    fetchJson(
      `${apiUrl}/api/v1/metrics/overview?${new URLSearchParams({
        startedAfter: startedAfter.toISOString(),
        startedBefore: now.toISOString(),
      })}`,
    ),
    fetchJson(
      `${apiUrl}/api/v1/metrics/breakdown?${new URLSearchParams({
        startedAfter: startedAfter.toISOString(),
        startedBefore: now.toISOString(),
        dimension: "model",
        limit: "10",
      })}`,
    ),
  ]);
  const queryMs = performance.now() - queryStarted;

  process.stdout.write(
    `${JSON.stringify(
      {
        runId,
        traceCount,
        insertMs: Math.round(insertMs),
        backfillMs: Math.round(backfillMs),
        queryMs: Math.round(queryMs),
        points: arrayLength(overview, "series"),
        breakdownItems: arrayLength(breakdown, "items"),
        dataThrough: scopeValue(overview, "dataThrough"),
      },
      null,
      2,
    )}\n`,
  );
} finally {
  await pool.end();
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function positiveInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("--traces must be a positive integer");
  }
  return parsed;
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} failed with HTTP ${response.status}`);
  }
  return (await response.json()) as Record<string, unknown>;
}

function arrayLength(
  value: Record<string, unknown>,
  key: string,
): number {
  const array = value[key];
  return Array.isArray(array) ? array.length : 0;
}

function scopeValue(
  value: Record<string, unknown>,
  key: string,
): unknown {
  const scope = value.scope;
  return typeof scope === "object" && scope !== null
    ? (scope as Record<string, unknown>)[key]
    : null;
}
