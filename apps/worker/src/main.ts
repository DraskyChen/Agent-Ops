import pg from "pg";

import { createTraceAggregationWorker } from "./application/aggregate-trace-job.js";
import { loadWorkerConfig } from "./config.js";
import { createPostgresAggregationJobStore } from "./infrastructure/postgres/aggregation-job-store.js";

const config = loadWorkerConfig();
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolSize,
});
const jobStore = createPostgresAggregationJobStore(pool);
const worker = createTraceAggregationWorker(jobStore);
let stopping = false;

async function run(): Promise<void> {
  process.stdout.write("Agent Ops worker connected and waiting for jobs.\n");
  while (!stopping) {
    try {
      const processed = await worker.processNextJob();
      if (!processed) {
        await sleep(config.pollIntervalMs);
      }
    } catch (error) {
      process.stderr.write(
        `Worker loop error: ${
          error instanceof Error ? error.message : String(error)
        }\n`,
      );
      await sleep(config.pollIntervalMs);
    }
  }
  await pool.end();
  process.stdout.write("Agent Ops worker stopped.\n");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

await run();
