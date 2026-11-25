import { trace, type Tracer } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  AlwaysOnSampler,
  SimpleSpanProcessor,
  type SpanExporter,
} from "@opentelemetry/sdk-trace";

import { configureContentCapture } from "./content.js";
import {
  SCHEMA_VERSION,
  SDK_NAME,
  type Environment,
} from "./generated.js";
import { SDK_VERSION } from "./version.js";

export interface TracingConfig {
  serviceName: string;
  serviceVersion: string;
  appName: string;
  environment: Environment;
  endpoint: string;
  headers?: Record<string, string>;
  team?: string;
  spanExporter?: SpanExporter;
  simpleExporter?: boolean;
  autoDetectResources?: boolean;
  contentCapture?: "full" | "metadata_only";
  contentEndpoint?: string;
  contentToken?: string;
  contentTimeoutMs?: number;
  contentMaxBytes?: number;
}

let activeSdk: NodeSDK | undefined;

export async function configureTracing(config: TracingConfig): Promise<void> {
  if (activeSdk !== undefined) {
    throw new Error("Agent Ops tracing has already been configured");
  }

  const exporter =
    config.spanExporter ??
    new OTLPTraceExporter({
      url: config.endpoint,
      headers: config.headers,
    });
  const resource = resourceFromAttributes({
    "service.name": config.serviceName,
    "service.version": config.serviceVersion,
    "deployment.environment.name": config.environment,
    "agent.app.name": config.appName,
    "agent.sdk.name": SDK_NAME,
    "agent.sdk.version": SDK_VERSION,
    "agent.schema.version": SCHEMA_VERSION,
    ...(config.team === undefined ? {} : { "agent.team": config.team }),
  });

  activeSdk = new NodeSDK(
    config.simpleExporter === true
      ? {
          resource,
          autoDetectResources: config.autoDetectResources ?? true,
          sampler: new AlwaysOnSampler(),
          spanProcessors: [new SimpleSpanProcessor({ exporter })],
          instrumentations: [],
          logRecordProcessors: [],
          metricReaders: [],
        }
      : {
          resource,
          autoDetectResources: config.autoDetectResources ?? true,
          sampler: new AlwaysOnSampler(),
          traceExporter: exporter,
          instrumentations: [],
          logRecordProcessors: [],
          metricReaders: [],
        },
  );
  activeSdk.start();

  configureContentCapture({
    enabled: config.contentCapture === "full",
    endpoint:
      config.contentEndpoint ??
      new URL("/api/v1/content", config.endpoint).toString(),
    ownerApp: config.appName,
    ...(config.contentToken === undefined
      ? {}
      : { token: config.contentToken }),
    ...(config.contentTimeoutMs === undefined
      ? {}
      : { timeoutMs: config.contentTimeoutMs }),
    ...(config.contentMaxBytes === undefined
      ? {}
      : { maxBytes: config.contentMaxBytes }),
  });
}

export function getAgentTracer(): Tracer {
  return trace.getTracer(SDK_NAME, SDK_VERSION);
}

export async function shutdownTracing(): Promise<void> {
  if (activeSdk === undefined) {
    return;
  }
  await activeSdk.shutdown();
  activeSdk = undefined;
}

