import type { Pool } from "pg";

import type {
  IngestBatchWrite,
  IngestWriteReceipt,
  TraceBatchWriter,
} from "../../application/ingest.js";
import { persistBatch } from "./ingest-store.js";

export interface TraceBatchWriterOptions {
  maxLatenessHours: number;
}

export function createPostgresTraceBatchWriter(
  pool: Pool,
  options: TraceBatchWriterOptions = { maxLatenessHours: 24 },
): TraceBatchWriter {
  return {
    persist(input: IngestBatchWrite): Promise<IngestWriteReceipt> {
      return persistBatch(pool, input, options);
    },
  };
}
