import { fileURLToPath } from "node:url";
import { resolve as resolvePath } from "node:path";

import {
  normalizeSpanType,
  type CanonicalSpan,
  type CanonicalSpanEvent,
  type ContentRecorded,
  type Environment,
} from "@agent-ops/contracts";
import protobuf, { type Type } from "protobufjs";

import type {
  DecodedIngestBatch,
  RejectedSpan,
} from "../../application/ingest.js";

const protoPath = fileURLToPath(
  new URL(
    "../../../proto/opentelemetry/proto/collector/trace/v1/trace_service.proto",
    import.meta.url,
  ),
);
const protoRoot = fileURLToPath(new URL("../../../proto/", import.meta.url));

interface PlainAnyValue {
  stringValue?: string;
  boolValue?: boolean;
  intValue?: string | number;
  doubleValue?: number;
  arrayValue?: { values?: PlainAnyValue[] };
  kvlistValue?: { values?: PlainKeyValue[] };
  bytesValue?: string;
}

interface PlainKeyValue {
  key?: string;
  value?: PlainAnyValue;
}

interface PlainResource {
  attributes?: PlainKeyValue[];
}

interface PlainEvent {
  timeUnixNano?: string | number;
  name?: string;
  attributes?: PlainKeyValue[];
}

interface PlainStatus {
  message?: string;
  code?: number;
}

interface PlainSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  attributes?: PlainKeyValue[];
  events?: PlainEvent[];
  status?: PlainStatus;
}

interface PlainScopeSpans {
  spans?: PlainSpan[];
}

interface PlainResourceSpans {
  resource?: PlainResource;
  scopeSpans?: PlainScopeSpans[];
}

interface PlainExportTraceRequest {
  resourceSpans?: PlainResourceSpans[];
}

export type DecodedOtlpBatch = DecodedIngestBatch;

let requestTypePromise: Promise<Type> | undefined;
let responseTypePromise: Promise<Type> | undefined;

export async function decodeOtlpTraceRequest(
  buffer: Uint8Array,
): Promise<DecodedOtlpBatch> {
  const requestType = await getRequestType();
  const message = requestType.decode(buffer);
  const request = requestType.toObject(message, {
    arrays: true,
    bytes: String,
    defaults: true,
    enums: Number,
    longs: String,
    objects: true,
  }) as PlainExportTraceRequest;

  const spans: CanonicalSpan[] = [];
  const rejected: RejectedSpan[] = [];
  const receivedAt = new Date().toISOString();

  for (const resourceSpans of request.resourceSpans ?? []) {
    const resourceAttributes = toAttributes(
      resourceSpans.resource?.attributes ?? [],
    );
    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      for (const rawSpan of scopeSpans.spans ?? []) {
        const decoded = decodeSpan(rawSpan, resourceAttributes, receivedAt);
        if ("reason" in decoded) {
          rejected.push(decoded);
        } else {
          spans.push(decoded);
        }
      }
    }
  }

  return { spans, rejected };
}

export async function encodeOtlpTraceResponse(
  rejectedSpans = 0,
  errorMessage = "",
): Promise<Uint8Array> {
  const responseType = await getResponseType();
  const message = responseType.create(
    rejectedSpans > 0
      ? {
          partialSuccess: {
            rejectedSpans,
            errorMessage,
          },
        }
      : {},
  );
  return responseType.encode(message).finish();
}

function decodeSpan(
  rawSpan: PlainSpan,
  resourceAttributes: Record<string, unknown>,
  receivedAt: string,
): CanonicalSpan | RejectedSpan {
  const traceId = bytesToHex(rawSpan.traceId);
  const spanId = bytesToHex(rawSpan.spanId);
  if (traceId.length !== 32 || spanId.length !== 16) {
    return {
      ...(traceId === "" ? {} : { traceId }),
      ...(spanId === "" ? {} : { spanId }),
      reason: "traceId and spanId must be 16-byte OTLP identifiers",
    };
  }

  const name = rawSpan.name ?? "";
  if (name.trim() === "") {
    return { traceId, spanId, reason: "span name is required" };
  }

  const attributes = toAttributes(rawSpan.attributes ?? []);
  const startTimeUnixNano = longString(rawSpan.startTimeUnixNano);
  const endTimeUnixNano = longString(rawSpan.endTimeUnixNano);
  if (startTimeUnixNano === "" || endTimeUnixNano === "") {
    return { traceId, spanId, reason: "span start and end times are required" };
  }

  const spanType = normalizeSpanType(
    stringAttribute(attributes, "agent.span.type") ?? "custom",
  );
  const contentRecorded = normalizeContentRecorded(
    stringAttribute(attributes, "agent.content.recorded"),
  );
  const events = (rawSpan.events ?? []).map((event, index) =>
    decodeEvent(event, index),
  );

  return {
    traceId,
    spanId,
    ...(bytesToHex(rawSpan.parentSpanId) === ""
      ? {}
      : { parentSpanId: bytesToHex(rawSpan.parentSpanId) }),
    name,
    spanType,
    ...optional(
      "spanSubtype",
      stringAttribute(attributes, "agent.span.subtype"),
    ),
    startTimeUnixNano,
    endTimeUnixNano,
    status:
      rawSpan.status?.code === 1
        ? "OK"
        : rawSpan.status?.code === 2
          ? "ERROR"
          : "UNSET",
    ...optional("errorType", stringAttribute(attributes, "error.type")),
    ...optional(
      "errorCategory",
      stringAttribute(attributes, "agent.error.category"),
    ),
    ...optional(
      "serviceName",
      stringAttribute(resourceAttributes, "service.name"),
    ),
    ...optional(
      "serviceVersion",
      stringAttribute(resourceAttributes, "service.version"),
    ),
    ...optional(
      "environment",
      normalizeEnvironment(
        stringAttribute(resourceAttributes, "deployment.environment.name"),
      ),
    ),
    resourceAttributes,
    attributes,
    events,
    ...optional(
      "inputTokens",
      numberAttribute(attributes, "gen_ai.usage.input_tokens"),
    ),
    ...optional(
      "outputTokens",
      numberAttribute(attributes, "gen_ai.usage.output_tokens"),
    ),
    ...optional(
      "cachedInputTokens",
      numberAttribute(attributes, "agent.llm.tokens.cached"),
    ),
    ...optional(
      "reasoningTokens",
      numberAttribute(attributes, "agent.llm.tokens.reasoning"),
    ),
    ...optional(
      "ttftMs",
      numberAttribute(attributes, "agent.llm.ttft_ms"),
    ),
    ...optional("costMicros", numberAttribute(attributes, "agent.llm.cost")),
    contentRecorded,
    ...optional(
      "inputContentId",
      stringAttribute(attributes, "agent.input.ref"),
    ),
    ...optional(
      "outputContentId",
      stringAttribute(attributes, "agent.output.ref"),
    ),
    schemaVersion:
      stringAttribute(resourceAttributes, "agent.schema.version") ?? "0.1",
    receivedAt,
  };
}

function decodeEvent(
  event: PlainEvent,
  index: number,
): CanonicalSpanEvent {
  return {
    index,
    name: event.name ?? "event",
    eventTimeUnixNano: longString(event.timeUnixNano),
    attributes: toAttributes(event.attributes ?? []),
  };
}

function toAttributes(values: PlainKeyValue[]): Record<string, unknown> {
  const attributes: Record<string, unknown> = {};
  for (const value of values) {
    if (value.key !== undefined) {
      attributes[value.key] = anyValue(value.value);
    }
  }
  return attributes;
}

function anyValue(value: PlainAnyValue | undefined): unknown {
  if (value === undefined) {
    return null;
  }
  if (value.stringValue !== undefined) {
    return value.stringValue;
  }
  if (value.boolValue !== undefined) {
    return value.boolValue;
  }
  if (value.intValue !== undefined) {
    return Number(value.intValue);
  }
  if (value.doubleValue !== undefined) {
    return value.doubleValue;
  }
  if (value.arrayValue !== undefined) {
    return (value.arrayValue.values ?? []).map(anyValue);
  }
  if (value.kvlistValue !== undefined) {
    return toAttributes(value.kvlistValue.values ?? []);
  }
  if (value.bytesValue !== undefined) {
    return value.bytesValue;
  }
  return null;
}

function stringAttribute(
  attributes: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = attributes[key];
  return typeof value === "string" ? value : undefined;
}

function numberAttribute(
  attributes: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = attributes[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function bytesToHex(value: unknown): string {
  if (typeof value === "string" && value !== "") {
    return Buffer.from(value, "base64").toString("hex");
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("hex");
  }
  return "";
}

function longString(value: string | number | undefined): string {
  return value === undefined ? "" : String(value);
}

function normalizeContentRecorded(
  value: string | undefined,
): ContentRecorded {
  return value === "full" ? "full" : "metadata_only";
}

function normalizeEnvironment(
  value: string | undefined,
): Environment | undefined {
  return value === "prod" ||
    value === "staging" ||
    value === "dev" ||
    value === "test"
    ? value
    : undefined;
}

function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Record<K, V> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

async function getRequestType(): Promise<Type> {
  requestTypePromise ??= loadType(
    "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest",
  );
  return requestTypePromise;
}

async function getResponseType(): Promise<Type> {
  responseTypePromise ??= loadType(
    "opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse",
  );
  return responseTypePromise;
}

async function loadType(name: string): Promise<Type> {
  const root = new protobuf.Root();
  root.resolvePath = (_origin, target) => resolvePath(protoRoot, target);
  await root.load(protoPath);
  return root.lookupType(name);
}

