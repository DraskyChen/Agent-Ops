import {
  buildHourlyRollupRows,
  type MetricFact,
  type MetricRollupRow,
} from "@agent-ops/metrics";

export interface MetricsRollupTransaction {
  claimNextBucket(): Promise<Date | null>;
  loadFacts(bucketStart: Date): Promise<MetricFact[]>;
  replaceBucket(bucketStart: Date, rows: MetricRollupRow[]): Promise<void>;
  complete(bucketStart: Date): Promise<void>;
}

export interface MetricsRollupStore {
  transaction<T>(
    work: (transaction: MetricsRollupTransaction) => Promise<T>,
  ): Promise<T>;
  markFailed(bucketStart: Date, error: Error): Promise<void>;
  rebuildBucket(bucketStart: Date): Promise<number>;
}

export interface MetricsRollupWorker {
  processNextJob(): Promise<boolean>;
}

export function createMetricsRollupWorker(
  store: MetricsRollupStore,
): MetricsRollupWorker {
  return {
    async processNextJob() {
      let bucketStart: Date | undefined;
      try {
        return await store.transaction(async (transaction) => {
          const claimed = await transaction.claimNextBucket();
          if (claimed === null) {
            return false;
          }
          bucketStart = claimed;
          await rebuildMetricsBucket(transaction, claimed);
          await transaction.complete(claimed);
          return true;
        });
      } catch (error) {
        if (bucketStart !== undefined) {
          await store.markFailed(bucketStart, normalizeError(error));
        }
        throw error;
      }
    },
  };
}

export async function rebuildMetricsBucket(
  transaction: MetricsRollupTransaction,
  bucketStart: Date,
): Promise<number> {
  const facts = await transaction.loadFacts(bucketStart);
  const rows = buildHourlyRollupRows(facts, bucketStart);
  await transaction.replaceBucket(bucketStart, rows);
  return rows.length;
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
