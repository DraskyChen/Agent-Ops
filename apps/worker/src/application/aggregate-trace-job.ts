import type {
  AggregatedTrace,
  StoredTraceSpan,
} from "../domain/trace-aggregation.js";
import { aggregateTraceSpans } from "../domain/trace-aggregation.js";

export interface AggregationTransaction {
  claimNextTraceId(): Promise<string | null>;
  loadSpans(traceId: string): Promise<StoredTraceSpan[]>;
  priceSpans(spans: StoredTraceSpan[]): Promise<void>;
  saveTrace(trace: AggregatedTrace): Promise<void>;
  schedule(traceId: string, notBefore: Date): Promise<void>;
  complete(traceId: string): Promise<void>;
}

export interface AggregationJobStore {
  transaction<T>(
    work: (transaction: AggregationTransaction) => Promise<T>,
  ): Promise<T>;
  markFailed(traceId: string, error: Error): Promise<void>;
}

export interface TraceAggregationWorker {
  processNextJob(): Promise<boolean>;
}

export interface TraceAggregationWorkerOptions {
  now?: () => Date;
  rootSealGraceMs?: number;
  idleTimeoutMs?: number;
}

export function createTraceAggregationWorker(
  store: AggregationJobStore,
  options: TraceAggregationWorkerOptions = {},
): TraceAggregationWorker {
  const now = options.now ?? (() => new Date());
  const rootSealGraceMs = options.rootSealGraceMs ?? 120_000;
  const idleTimeoutMs = options.idleTimeoutMs ?? 15 * 60_000;
  return {
    async processNextJob() {
      let traceId: string | undefined;
      try {
        return await store.transaction(async (transaction) => {
          const claimedTraceId = await transaction.claimNextTraceId();
          if (claimedTraceId === null) {
            return false;
          }
          traceId = claimedTraceId;

          const spans = await transaction.loadSpans(claimedTraceId);
          await transaction.priceSpans(spans);
          const trace = aggregateTraceSpans(claimedTraceId, spans, {
            now: now(),
            rootSealGraceMs,
            idleTimeoutMs,
          });
          await transaction.saveTrace(trace);
          if (trace.sealAfter === null) {
            await transaction.complete(claimedTraceId);
          } else {
            await transaction.schedule(claimedTraceId, trace.sealAfter);
          }
          return true;
        });
      } catch (error) {
        if (traceId !== undefined) {
          await store.markFailed(traceId, normalizeError(error));
        }
        throw error;
      }
    },
  };
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
