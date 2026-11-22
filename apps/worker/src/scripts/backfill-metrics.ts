import pg from "pg";

import { metricBucketStart } from "@agent-ops/metrics";

import { createPostgresMetricsRollupStore } from "../infrastructure/postgres/metrics-rollup-store.js";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgres://agent_ops:agent_ops_dev@127.0.0.1:5433/agent_ops";
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const store = createPostgresMetricsRollupStore(pool);

try {
  const range = await resolveRange();
  const first = metricBucketStart(range.startedAfter, "hour");
  const last = metricBucketStart(range.startedBefore, "hour");
  let count = 0;
  for (
    let cursor = first;
    cursor <= last;
    cursor = new Date(cursor.getTime() + 60 * 60 * 1000)
  ) {
    await store.rebuildBucket(cursor);
    count += 1;
    if (count % 24 === 0) {
      process.stdout.write(
        `Rebuilt ${count} metric bucket(s) through ${cursor.toISOString()}\n`,
      );
    }
  }
  await pool.query(
    `update trace_metric_rollup_jobs set
      state = 'completed',
      completed_at = now(),
      last_error = null
     where bucket_start between $1 and $2`,
    [first, last],
  );
  process.stdout.write(
    `Metric backfill complete: ${count} bucket(s), ${first.toISOString()} through ${last.toISOString()}\n`,
  );
} finally {
  await pool.end();
}

async function resolveRange(): Promise<{
  startedAfter: Date;
  startedBefore: Date;
}> {
  const from = argument("--from");
  const to = argument("--to");
  if (from !== undefined || to !== undefined) {
    const startedAfter = parseDate(from, "--from");
    const startedBefore = parseDate(to, "--to");
    if (startedBefore < startedAfter) {
      throw new Error("--to must be later than --from");
    }
    return { startedAfter, startedBefore };
  }

  const result = await pool.query<{
    first_start: Date | null;
    last_start: Date | null;
  }>(
    `select min(start_time) as first_start, max(start_time) as last_start
     from traces
     where start_time is not null`,
  );
  const first = result.rows[0]?.first_start;
  const last = result.rows[0]?.last_start;
  if (first === null || first === undefined || last === null || last === undefined) {
    throw new Error("No trace projections are available for metric backfill");
  }
  return {
    startedAfter: first,
    startedBefore: new Date(last.getTime() + 1),
  };
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function parseDate(value: string | undefined, name: string): Date {
  if (value === undefined) {
    throw new Error(`${name} requires an ISO timestamp`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} must be an ISO timestamp`);
  }
  return date;
}
