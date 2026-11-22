import pg from "pg";

import { createTraceAggregationWorker } from "./application/aggregate-trace-job.js";
import { createContentRetentionWorker } from "./application/content-retention.js";
import { createMetricsRollupWorker } from "./application/metrics-rollup.js";
import { loadWorkerConfig } from "./config.js";
import { createPostgresAggregationJobStore } from "./infrastructure/postgres/aggregation-job-store.js";
import { createPostgresContentRetentionRepository } from "./infrastructure/postgres/content-retention-repository.js";
import { createPostgresMetricsRollupStore } from "./infrastructure/postgres/metrics-rollup-store.js";
import { createMinioContentDeleter } from "./infrastructure/minio/content-deleter.js";

const config = loadWorkerConfig();
const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolSize,
});
const jobStore = createPostgresAggregationJobStore(pool);
const worker = createTraceAggregationWorker(jobStore, {
  rootSealGraceMs: config.rootSealGraceMs,
  idleTimeoutMs: config.idleTimeoutMs,
});
const contentRetention = createContentRetentionWorker(
  createPostgresContentRetentionRepository(pool),
  createMinioContentDeleter(config.content),
);
const metricsRollup = createMetricsRollupWorker(
  createPostgresMetricsRollupStore(pool),
);
let stopping = false;
let nextContentCleanupAt = 0;

async function run(): Promise<void> {
  process.stdout.write("Agent Ops worker connected and waiting for jobs.\n");
  while (!stopping) {
    try {
      const processed = await worker.processNextJob();
      const metricsProcessed = await metricsRollup.processNextJob();
      if (!processed && !metricsProcessed) {
        if (Date.now() >= nextContentCleanupAt) {
          const result = await contentRetention.runOnce();
          nextContentCleanupAt =
            Date.now() + config.contentCleanupIntervalMs;
          if (result.expired > 0 || result.failed > 0) {
            process.stdout.write(
              `Content retention: ${result.expired} expired, ${result.failed} deferred.\n`,
            );
          }
        }
      }
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
