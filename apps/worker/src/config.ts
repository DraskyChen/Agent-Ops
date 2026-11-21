export interface WorkerConfig {
  databaseUrl: string;
  databasePoolSize: number;
  pollIntervalMs: number;
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
  };
}

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
