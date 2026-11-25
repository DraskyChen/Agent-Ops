import {
  ATTR,
  normalizeTaskType,
  type ContentRecorded,
  type ErrorCategory,
  type RunStatus,
  type ToolType,
} from "./generated.js";
import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from "@opentelemetry/api";

import {
  commonAttributes,
  redact,
  recordError,
  summarize,
  type CommonSpanOptions,
} from "./attributes.js";
import { captureContent } from "./content.js";
import { getAgentTracer } from "./runtime.js";

export interface ContentSpanOptions<TResult = unknown> {
  inputContent?: unknown;
  extractOutputContent?: (result: TResult) => unknown;
}

export interface AgentRunOptions<TResult = unknown>
  extends CommonSpanOptions,
    ContentSpanOptions<TResult> {
  name?: string;
  sessionId: string;
  taskType: string;
  runId?: string;
  userId?: string;
  promptVersion?: string;
  evalCaseId?: string;
}

export interface AgentRunHandle {
  complete(status: RunStatus, stopReason?: string): void;
  setUserId(userId: string): void;
  setCost(costMicros: number, currency: string): void;
  setOutputSummary(outputSummary: string): void;
}

export async function withAgentRun<T>(
  options: AgentRunOptions<T>,
  operation: (run: AgentRunHandle) => Promise<T>,
): Promise<T> {
  const span = getAgentTracer().startSpan(options.name ?? "agent.run", {
    kind: SpanKind.INTERNAL,
    attributes: {
      ...commonAttributes("agent.run", options),
      [ATTR.agentSessionId]: options.sessionId,
      [ATTR.agentTaskType]: normalizeTaskType(options.taskType),
      ...optional(ATTR.agentRunId, options.runId),
      ...optional(ATTR.agentUserId, options.userId),
      ...optional(ATTR.agentPromptVersion, options.promptVersion),
      ...optional(ATTR.agentEvalCaseId, options.evalCaseId),
    },
  });
  const inputContent = captureOptional("agent_input", options.inputContent);

  return context.with(trace.setSpan(context.active(), span), async () => {
    let businessStatus: RunStatus | undefined;
    let stopReason: string | undefined;
    const handle: AgentRunHandle = {
      complete(status, reason) {
        businessStatus = status;
        stopReason = reason;
      },
      setUserId(userId) {
        span.setAttribute(ATTR.agentUserId, userId);
      },
      setCost(costMicros, currency) {
        span.setAttributes({
          [ATTR.agentRunCostTotal]: costMicros,
          [ATTR.agentCostCurrency]: currency,
        });
      },
      setOutputSummary(outputSummary) {
        span.setAttribute(
          ATTR.agentOutputSummary,
          summarize(outputSummary) ?? "",
        );
      },
    };

    try {
      const result = await operation(handle);
      const outputContent = captureOptional(
        "agent_output",
        options.extractOutputContent?.(result),
      );
      await attachContent(span, inputContent, outputContent);
      const finalStatus = businessStatus ?? "partial";
      span.setAttribute(ATTR.agentRunStatus, finalStatus);
      if (stopReason !== undefined) {
        span.setAttribute(ATTR.agentRunStopReason, stopReason);
      }
      span.setStatus({
        code:
          finalStatus === "success" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        ...(finalStatus === "success"
          ? {}
          : { message: `Agent run finished as ${finalStatus}` }),
      });
      return result;
    } catch (error) {
      await attachContent(span, inputContent);
      span.setAttributes({
        [ATTR.agentRunStatus]: "failed",
        [ATTR.agentRunStopReason]: "error",
      });
      span.setStatus({ code: SpanStatusCode.ERROR });
      recordError(span, error, "other");
      throw error;
    } finally {
      span.end();
    }
  });
}

export interface LlmCallTelemetry {
  outputSummary?: string;
  inputTokens?: number;
  outputTokens?: number;
  responseModel?: string;
  finishReasons?: string[];
  cachedTokens?: number;
  reasoningTokens?: number;
  ttftMs?: number;
  streaming?: boolean;
  retryCount?: number;
  costMicros?: number;
}

export interface LlmCallOptions<TResult = unknown>
  extends CommonSpanOptions,
    LlmCallTelemetry,
    ContentSpanOptions<TResult> {
  name?: string;
  provider: string;
  requestModel: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  promptId?: string;
  promptVersion?: string;
  extractTelemetry?: (result: TResult) => LlmCallTelemetry;
}

export async function withLlmCall<T>(
  options: LlmCallOptions<T>,
  operation: () => Promise<T>,
): Promise<T> {
  return runSpan(
    options.name ?? "chat",
    {
      ...commonAttributes("llm.call", options),
      [ATTR.genAiProviderName]: options.provider,
      [ATTR.genAiRequestModel]: options.requestModel,
      ...optional(ATTR.genAiRequestTemperature, options.temperature),
      ...optional(ATTR.genAiRequestTopP, options.topP),
      ...optional(ATTR.genAiRequestMaxTokens, options.maxTokens),
      ...optional(ATTR.agentPromptId, options.promptId),
      ...optional(ATTR.agentPromptVersion, options.promptVersion),
    },
    async () => {
      const result = await operation();
      const telemetry = {
        ...pickTelemetry(options),
        ...(options.extractTelemetry?.(result) ?? {}),
      };
      trace
        .getSpan(context.active())
        ?.setAttributes(llmTelemetryAttributes(telemetry));
      return result;
    },
    "model",
    {
      prefix: "llm",
      inputContent: options.inputContent,
      extractOutputContent: options.extractOutputContent,
    },
  );
}

export interface ToolCallOptions<TResult = unknown>
  extends CommonSpanOptions,
    ContentSpanOptions<TResult> {
  name: string;
  type?: ToolType;
  callId?: string;
  argsSummary?: string;
  retryCount?: number;
}

export async function withToolCall<T>(
  options: ToolCallOptions,
  operation: () => Promise<T>,
): Promise<T> {
  return runSpan(
    options.name,
    {
      ...commonAttributes("tool.call", options),
      [ATTR.agentToolName]: options.name,
      ...optional(ATTR.agentToolType, options.type),
      ...optional(ATTR.agentToolCallId, options.callId),
      ...optional(ATTR.agentToolRetryCount, options.retryCount),
      ...(options.argsSummary === undefined
        ? {}
        : { [ATTR.agentToolArgsSummary]: summarize(options.argsSummary) }),
    },
    operation,
    "tool",
    {
      prefix: "tool",
      inputContent: options.inputContent,
      extractOutputContent: options.extractOutputContent,
    },
  );
}

export interface RetrievalOptions<TResult = unknown>
  extends CommonSpanOptions,
    ContentSpanOptions<TResult> {
  name?: string;
  source?: string;
  query?: string;
  topK?: number;
  resultCount?: number;
  documentIds?: string[];
  scores?: number[];
}

export async function withRetrieval<T>(
  options: RetrievalOptions,
  operation: () => Promise<T>,
): Promise<T> {
  return runSpan(
    options.name ?? "retrieval",
    {
      ...commonAttributes("retrieval", options),
      ...optional(ATTR.agentRetrievalSource, options.source),
      ...(options.query === undefined
        ? {}
        : { [ATTR.agentRetrievalQuerySummary]: summarize(options.query) }),
      ...optional(ATTR.agentRetrievalTopK, options.topK),
      ...optional(ATTR.agentRetrievalResultCount, options.resultCount),
      ...optional(
        ATTR.agentRetrievalDocIds,
        options.documentIds?.slice(0, 20),
      ),
      ...optional(ATTR.agentRetrievalScores, options.scores?.slice(0, 20)),
    },
    operation,
    "other",
    {
      prefix: "retrieval",
      inputContent: options.inputContent,
      extractOutputContent: options.extractOutputContent,
    },
  );
}

export interface SubAgentOptions<TResult = unknown>
  extends CommonSpanOptions,
    ContentSpanOptions<TResult> {
  name: string;
  role?: string;
}

export async function withSubAgent<T>(
  options: SubAgentOptions,
  operation: () => Promise<T>,
): Promise<T> {
  return runSpan(
    options.name,
    {
      ...commonAttributes("sub_agent", options),
      [ATTR.agentSubAgentName]: options.name,
      ...optional(ATTR.agentSubAgentRole, options.role),
    },
    operation,
    "other",
    {
      prefix: "sub_agent",
      inputContent: options.inputContent,
      extractOutputContent: options.extractOutputContent,
    },
  );
}

export function currentTraceId(): string | undefined {
  return trace.getSpan(context.active())?.spanContext().traceId;
}

export function currentSpanId(): string | undefined {
  return trace.getSpan(context.active())?.spanContext().spanId;
}

async function runSpan<T>(
  name: string,
  attributes: Attributes,
  operation: () => Promise<T>,
  errorCategory: ErrorCategory,
  contentOptions?: ContentSpanOptions<T> & { prefix: string },
): Promise<T> {
  const span = getAgentTracer().startSpan(name, {
    kind: SpanKind.INTERNAL,
    attributes,
  });
  const inputContent = captureOptional(
    `${contentOptions?.prefix ?? "span"}_input`,
    contentOptions?.inputContent,
  );

  return context.with(trace.setSpan(context.active(), span), async () => {
    try {
      const result = await operation();
      const outputContent = captureOptional(
        `${contentOptions?.prefix ?? "span"}_output`,
        contentOptions?.extractOutputContent?.(result),
      );
      await attachContent(span, inputContent, outputContent);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      await attachContent(span, inputContent);
      span.setStatus({ code: SpanStatusCode.ERROR });
      recordError(span, error, errorCategory);
      throw error;
    } finally {
      span.end();
    }
  });
}

function captureOptional(
  kind: string,
  value: unknown,
): Promise<string | undefined> {
  return value === undefined ? Promise.resolve(undefined) : captureContent(kind, value);
}

async function attachContent(
  span: Span,
  inputContent: Promise<string | undefined>,
  outputContent: Promise<string | undefined> = Promise.resolve(undefined),
): Promise<void> {
  const [inputRef, outputRef] = await Promise.all([
    inputContent,
    outputContent,
  ]);
  if (inputRef === undefined && outputRef === undefined) {
    return;
  }
  span.setAttributes({
    [ATTR.agentContentRecorded]: "full",
    ...(inputRef === undefined ? {} : { [ATTR.agentInputRef]: inputRef }),
    ...(outputRef === undefined ? {} : { [ATTR.agentOutputRef]: outputRef }),
  });
}

function optional(
  key: string,
  value: string | number | boolean | string[] | number[] | undefined,
): Attributes {
  return value === undefined
    ? {}
    : { [key]: Array.isArray(value) ? value : value };
}

function pickTelemetry(options: LlmCallTelemetry): LlmCallTelemetry {
  return {
    ...optionalValue("outputSummary", options.outputSummary),
    ...optionalValue("inputTokens", options.inputTokens),
    ...optionalValue("outputTokens", options.outputTokens),
    ...optionalValue("responseModel", options.responseModel),
    ...optionalValue("finishReasons", options.finishReasons),
    ...optionalValue("cachedTokens", options.cachedTokens),
    ...optionalValue("reasoningTokens", options.reasoningTokens),
    ...optionalValue("ttftMs", options.ttftMs),
    ...optionalValue("streaming", options.streaming),
    ...optionalValue("retryCount", options.retryCount),
    ...optionalValue("costMicros", options.costMicros),
  };
}

function llmTelemetryAttributes(
  telemetry: LlmCallTelemetry,
): Attributes {
  return {
    ...optional(
      ATTR.agentOutputSummary,
      telemetry.outputSummary === undefined
        ? undefined
        : summarize(telemetry.outputSummary),
    ),
    ...optional(ATTR.genAiUsageInputTokens, telemetry.inputTokens),
    ...optional(ATTR.genAiUsageOutputTokens, telemetry.outputTokens),
    ...optional(ATTR.genAiResponseModel, telemetry.responseModel),
    ...optional(ATTR.genAiResponseFinishReasons, telemetry.finishReasons),
    ...optional(ATTR.agentLlmTokensCached, telemetry.cachedTokens),
    ...optional(ATTR.agentLlmTokensReasoning, telemetry.reasoningTokens),
    ...optional(ATTR.agentLlmTtftMs, telemetry.ttftMs),
    ...optional(ATTR.agentLlmStreaming, telemetry.streaming),
    ...optional(ATTR.agentLlmRetryCount, telemetry.retryCount),
    ...optional(ATTR.agentLlmCost, telemetry.costMicros),
  };
}

function optionalValue<K extends keyof LlmCallTelemetry>(
  key: K,
  value: LlmCallTelemetry[K],
): Partial<Pick<LlmCallTelemetry, K>> {
  return value === undefined ? {} : ({ [key]: value } as Pick<LlmCallTelemetry, K>);
}

export function redactForSummary(value: string): string | undefined {
  return summarize(value) ?? redact(value);
}

export type { ContentRecorded };

