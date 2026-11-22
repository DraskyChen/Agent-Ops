export interface MinioContentConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export interface WorkerConfig {
  databaseUrl: string;
  databasePoolSize: number;
  pollIntervalMs: number;
  rootSealGraceMs: number;
  idleTimeoutMs: number;
  contentCleanupIntervalMs: number;
  content: MinioContentConfig;
}

const DEFAULT_DATABASE_URL =
  "postgres://agent_ops:agent_ops_dev@127.0.0.1:5433/agent_ops";

export function loadWorkerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): WorkerConfig {
  return {
    databaseUrl: environment.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    databasePoolSize: positiveInteger(
      environment.WORKER_DATABASE_POOL_SIZE ?? "5",
      "WORKER_DATABASE_POOL_SIZE",
    ),
    pollIntervalMs: positiveInteger(
      environment.WORKER_POLL_INTERVAL_MS ?? "500",
      "WORKER_POLL_INTERVAL_MS",
    ),
    rootSealGraceMs: positiveInteger(
      environment.TRACE_ROOT_SEAL_GRACE_MS ?? "120000",
      "TRACE_ROOT_SEAL_GRACE_MS",
    ),
    idleTimeoutMs: positiveInteger(
      environment.TRACE_IDLE_TIMEOUT_MS ?? "900000",
      "TRACE_IDLE_TIMEOUT_MS",
    ),
    contentCleanupIntervalMs: positiveInteger(
      environment.CONTENT_CLEANUP_INTERVAL_MS ?? "900000",
      "CONTENT_CLEANUP_INTERVAL_MS",
    ),
    content: {
      endpoint: environment.S3_ENDPOINT ?? "http://127.0.0.1:9000",
      region: environment.S3_REGION ?? "us-east-1",
      bucket: environment.S3_BUCKET ?? "agent-ops-content",
      accessKey: environment.S3_ACCESS_KEY ?? "agent_ops",
      secretKey: environment.S3_SECRET_KEY ?? "agent_ops_dev_secret",
    },
  };
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
