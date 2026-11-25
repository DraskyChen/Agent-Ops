import { configureTracing } from "agent-ops-otel-sdk";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

try {
  loadEnvFile(
    fileURLToPath(new URL("../../../.env", import.meta.url)),
  );
} catch (error) {
  if (
    !(error instanceof Error) ||
    !("code" in error) ||
    error.code !== "ENOENT"
  ) {
    throw error;
  }
}

export const demoConfig = {
  serviceName: "agent-ops-examples",
  serviceVersion: "0.1.0",
  appName: "agent-platform-examples",
  environment: "staging" as const,
  endpoint:
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
    "http://127.0.0.1:4318/v1/traces",
  contentCapture: "full" as const,
  ...(process.env.AGENT_OPS_INGEST_TOKEN === undefined
    ? {}
    : { contentToken: process.env.AGENT_OPS_INGEST_TOKEN }),
};

export async function configureExamples(): Promise<void> {
  await configureTracing(demoConfig);
}

export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

