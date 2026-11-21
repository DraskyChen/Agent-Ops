import type { CanonicalSpan } from "@agent-ops/contracts";

export interface RejectedSpan {
  traceId?: string;
  spanId?: string;
  reason: string;
}

export interface DecodedIngestBatch {
  spans: CanonicalSpan[];
  rejected: RejectedSpan[];
}

export interface IngestBatchWrite extends DecodedIngestBatch {
  payload: Uint8Array;
}

export interface IngestWriteReceipt {
  acceptedCount: number;
  rejectedCount: number;
}

export interface OtlpCodec {
  decode(payload: Uint8Array): Promise<DecodedIngestBatch>;
  encodeResponse(rejectedCount: number, errorMessage: string): Promise<Uint8Array>;
}

export interface TraceBatchWriter {
  persist(input: IngestBatchWrite): Promise<IngestWriteReceipt>;
}

export interface IngestResponse {
  acceptedCount: number;
  rejectedCount: number;
  responseBody: Uint8Array;
}

export interface OtlpIngestService {
  receive(payload: Uint8Array): Promise<IngestResponse>;
}

export class InvalidOtlpBatchError extends Error {
  constructor(cause: unknown) {
    super("Invalid OTLP trace batch", { cause });
    this.name = "InvalidOtlpBatchError";
  }
}

export function createOtlpIngestService(
  codec: OtlpCodec,
  writer: TraceBatchWriter,
): OtlpIngestService {
  return {
    async receive(payload) {
      let decoded: DecodedIngestBatch;
      try {
        decoded = await codec.decode(payload);
      } catch (error) {
        throw new InvalidOtlpBatchError(error);
      }
      const persisted = await writer.persist({ payload, ...decoded });
      const responseBody = await codec.encodeResponse(
        persisted.rejectedCount,
        persisted.rejectedCount === 0
          ? ""
          : `${persisted.rejectedCount} span(s) rejected`,
      );
      return {
        acceptedCount: persisted.acceptedCount,
        rejectedCount: persisted.rejectedCount,
        responseBody,
      };
    },
  };
}
