import type { Pool } from "pg";

import type {
  IngestBatchWrite,
  IngestWriteReceipt,
  TraceBatchWriter,
} from "../../application/ingest.js";
import { persistBatch } from "./ingest-store.js";

export function createPostgresTraceBatchWriter(pool: Pool): TraceBatchWriter {
  return {
    persist(input: IngestBatchWrite): Promise<IngestWriteReceipt> {
      return persistBatch(pool, input);
    },
  };
}
