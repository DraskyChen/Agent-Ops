# Agent Ops TypeScript SDK

OpenTelemetry tracing helpers for Node.js agents that send traces to Agent Ops.

Current release: [`0.1.0`](https://github.com/DraskyChen/Agent-Ops/releases/tag/sdk-v0.1.0)
on [npm](https://www.npmjs.com/package/agent-ops-otel-sdk).

## Requirements

- Node.js 20 or newer
- An Agent Ops OTLP endpoint and ingest token

## Install

```bash
npm install agent-ops-otel-sdk@0.1.0
```

The package is ESM-only and does not support browser runtimes.

## Quick start

```ts
import {
  configureTracing,
  shutdownTracing,
  withAgentRun,
  withLlmCall,
  withToolCall,
} from "agent-ops-otel-sdk";

await configureTracing({
  serviceName: "support-agent",
  serviceVersion: "1.4.0",
  appName: "customer-support",
  environment: "prod",
  endpoint: "https://agent-ops.example.com/v1/traces",
  headers: {
    authorization: `Bearer ${process.env.AGENT_OPS_INGEST_TOKEN}`,
  },
});

try {
  await withAgentRun(
    {
      sessionId: "session-123",
      taskType: "support",
      inputSummary: "Resolve a duplicate subscription",
    },
    async (run) => {
      await withLlmCall(
        {
          provider: "deepseek",
          requestModel: "deepseek-flash",
          inputTokens: 420,
          outputTokens: 80,
        },
        async () => "Call the subscription tool.",
      );

      await withToolCall(
        {
          name: "cancel_subscription",
          argsSummary: '{"subscriptionId":"sub-b"}',
        },
        async () => ({ cancelled: true }),
      );

      run.complete("success", "final_answer");
    },
  );
} finally {
  await shutdownTracing();
}
```

To capture complete input and output content, set `contentCapture: "full"` and
provide `contentToken`. Captured content is redacted and uploaded through the
Agent Ops server before its content ID is attached to the span.

The package exposes `SDK_VERSION`, contract constants such as `ATTR`, and
helpers for `agent.run`, `llm.call`, `tool.call`, `retrieval`, and `sub_agent`
spans.

## License

Apache-2.0. See [LICENSE](LICENSE).
