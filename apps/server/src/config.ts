import type { PoolConfig } from "pg";

const DEFAULT_DATABASE_URL =
  "postgres://agent_ops:agent_ops_dev@127.0.0.1:5433/agent_ops";

export interface ServerConfig {
  host: string;
  port: number;
  database: PoolConfig;
  ingestToken?: string;
  content: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
    maxBytes: number;
    retentionDays: number;
  };
}

export function loadServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const port = Number(environment.AGENT_OPS_SERVER_PORT ?? "4318");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error("AGENT_OPS_SERVER_PORT must be a valid TCP port");
  }

  const max = Number(environment.DATABASE_POOL_SIZE ?? "10");
  if (!Number.isInteger(max) || max <= 0) {
    throw new Error("DATABASE_POOL_SIZE must be a positive integer");
  }

  const contentMaxBytes = Number(
    environment.S3_CONTENT_MAX_BYTES ?? String(2 * 1024 * 1024),
  );
  if (!Number.isInteger(contentMaxBytes) || contentMaxBytes <= 0) {
    throw new Error("S3_CONTENT_MAX_BYTES must be a positive integer");
  }

  const contentRetentionDays = Number(
    environment.S3_CONTENT_RETENTION_DAYS ?? "30",
  );
  if (!Number.isInteger(contentRetentionDays) || contentRetentionDays <= 0) {
    throw new Error("S3_CONTENT_RETENTION_DAYS must be a positive integer");
  }

  return {
    host: environment.AGENT_OPS_SERVER_HOST ?? "127.0.0.1",
    port,
    database: {
      connectionString: environment.DATABASE_URL ?? DEFAULT_DATABASE_URL,
      max,
    },
    ...(environment.AGENT_OPS_INGEST_TOKEN === undefined
      ? {}
      : { ingestToken: environment.AGENT_OPS_INGEST_TOKEN }),
    content: {
      endpoint: environment.S3_ENDPOINT ?? "http://127.0.0.1:9000",
      region: environment.S3_REGION ?? "us-east-1",
      bucket: environment.S3_BUCKET ?? "agent-ops-content",
      accessKey: environment.S3_ACCESS_KEY ?? "agent_ops",
      secretKey: environment.S3_SECRET_KEY ?? "agent_ops_dev_secret",
      maxBytes: contentMaxBytes,
      retentionDays: contentRetentionDays,
    },
  };
}
