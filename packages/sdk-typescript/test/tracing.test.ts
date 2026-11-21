import {
  ATTR,
  configureTracing,
  redact,
  shutdownTracing,
  withAgentRun,
  withLlmCall,
  withToolCall,
} from "../src/index.js";
import { SpanStatusCode } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exporter = new InMemorySpanExporter();

beforeAll(async () => {
  await configureTracing({
    serviceName: "test-agent",
    serviceVersion: "1.2.3",
    appName: "agent-ops-tests",
    environment: "test",
    endpoint: "http://127.0.0.1:4318/v1/traces",
    spanExporter: exporter,
    simpleExporter: true,
    autoDetectResources: false,
  });
});

afterAll(async () => {
  await shutdownTracing();
});

describe("Agent Ops TypeScript SDK", () => {
  it("creates one trace for the run, LLM call, and failed tool call", async () => {
    exporter.reset();

    await withAgentRun(
      {
        sessionId: "session-1",
        taskType: "refund",
        inputSummary: "user=alice@example.com phone=13800138000",
      },
      async (run) => {
        await withLlmCall(
          {
            provider: "test-provider",
            requestModel: "test-model",
            inputTokens: 120,
            outputTokens: 30,
          },
          async () => "model response",
        );

        await expect(
          withToolCall(
            {
              name: "query_order",
              argsSummary: "order=12346",
            },
            async () => {
              throw new Error("tool failed");
            },
          ),
        ).rejects.toThrow("tool failed");

        run.complete("success", "final_answer");
      },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const spans = exporter.getFinishedSpans();
    const root = requiredSpan(spans, "agent.run");
    const llm = requiredSpan(spans, "chat");
    const tool = requiredSpan(spans, "query_order");

    expect(root.attributes[ATTR.agentSpanType]).toBe("agent.run");
    expect(root.attributes[ATTR.agentRunStatus]).toBe("success");
    expect(root.attributes[ATTR.agentRunStopReason]).toBe("final_answer");
    expect(root.attributes[ATTR.agentInputSummary]).toBe(
      "user=[REDACTED_EMAIL] phone=[REDACTED_PHONE]",
    );
    expect(llm.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(tool.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(llm.spanContext().traceId).toBe(root.spanContext().traceId);
    expect(tool.spanContext().traceId).toBe(root.spanContext().traceId);
    expect(tool.attributes[ATTR.agentErrorCategory]).toBe("tool");
    expect(tool.status.code).toBe(SpanStatusCode.ERROR);
  });

  it("redacts common sensitive values", () => {
    expect(
      redact(
        "alice@example.com 13800138000 Bearer abcdefghijk sk-secret12345",
      ),
    ).toBe(
      "[REDACTED_EMAIL] [REDACTED_PHONE] Bearer [REDACTED_TOKEN] [REDACTED_API_KEY]",
    );
  });
});

function requiredSpan<T extends { name: string }>(
  spans: T[],
  name: string,
): T {
  const span = spans.find((candidate) => candidate.name === name);
  if (span === undefined) {
    throw new Error(`Missing span ${name}`);
  }
  return span;
}

