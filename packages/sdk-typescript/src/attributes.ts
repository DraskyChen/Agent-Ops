import {
  ATTR,
  type ContentRecorded,
  type ErrorCategory,
} from "@agent-ops/contracts";
import type { Attributes, Span } from "@opentelemetry/api";

export const REDACTION_RULE_VERSION = "agent-ops-redaction-v1";
const SUMMARY_MAX_CHARS = 256;

export interface CommonSpanOptions {
  contentRecorded?: ContentRecorded;
  inputSummary?: string;
  outputSummary?: string;
  inputRef?: string;
  outputRef?: string;
}

export function commonAttributes(
  spanType: string,
  options: CommonSpanOptions = {},
): Attributes {
  const contentRecorded = options.contentRecorded ?? "metadata_only";
  return {
    [ATTR.agentSpanType]: spanType,
    [ATTR.agentContentRecorded]: contentRecorded,
    [ATTR.agentRedactionApplied]: REDACTION_RULE_VERSION,
    ...boundedOptional(ATTR.agentInputSummary, options.inputSummary),
    ...boundedOptional(ATTR.agentOutputSummary, options.outputSummary),
    ...optional(ATTR.agentInputRef, options.inputRef),
    ...optional(ATTR.agentOutputRef, options.outputRef),
  };
}

export function recordError(
  span: Span,
  error: unknown,
  category: ErrorCategory = "other",
): void {
  const normalized = normalizeError(error);
  span.recordException(normalized);
  span.setAttributes({
    [ATTR.errorType]: normalized.name,
    [ATTR.agentErrorCategory]: category,
    "agent.error.message": redact(normalized.message).slice(0, 1024),
  });
}

export function redact(value: string): string {
  return value
    .replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[REDACTED_EMAIL]",
    )
    .replace(/\b1[3-9]\d{9}\b/g, "[REDACTED_PHONE]")
    .replace(/\b\d{17}[\dXx]\b/g, "[REDACTED_ID]")
    .replace(
      /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b/gi,
      "$1[REDACTED_TOKEN]",
    )
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_API_KEY]");
}

export function summarize(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return redact(value).slice(0, SUMMARY_MAX_CHARS);
}

function boundedOptional(
  key: string,
  value: string | undefined,
): Attributes {
  const normalized = summarize(value);
  return normalized === undefined ? {} : { [key]: normalized };
}

function optional(key: string, value: string | undefined): Attributes {
  return value === undefined ? {} : { [key]: value };
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === "string") {
    return new Error(redact(error));
  }
  return new Error("Unknown error");
}

