import type { OtlpIngestService } from "./ingest.js";
import type { ContentService } from "./content.js";
import type { TraceQueryService } from "./traces.js";

export interface IngestRequestMetadata {
  authorization?: string;
  apiKey?: string;
}

export type IngestRequestAuthorizer = (
  request: IngestRequestMetadata,
) => boolean;

export interface ServerDependencies {
  healthCheck: () => Promise<void>;
  traces: TraceQueryService;
  ingest: OtlpIngestService;
  content: ContentService;
  authorizeIngest: IngestRequestAuthorizer;
}
