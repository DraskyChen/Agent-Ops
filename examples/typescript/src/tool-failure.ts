import { withAgentRun, withLlmCall, withToolCall } from "agent-ops-sdk";

import { sleep } from "./shared.js";

export async function runToolFailureExample(): Promise<void> {
  await withAgentRun(
    {
      name: "support-agent",
      sessionId: `example-support-${Date.now()}`,
      taskType: "support",
      promptVersion: "support-v7",
      inputSummary:
        "Cancel the duplicate subscription and confirm the remaining account state.",
    },
    async (run) => {
      await withLlmCall(
        {
          name: "plan-cancellation",
          provider: "simulated",
          requestModel: "demo-model",
          inputTokens: 1540,
          outputTokens: 98,
          costMicros: 6700,
          inputSummary:
            "Find both subscriptions and determine which one is active.",
          outputSummary:
            "Call the billing tool to cancel the later duplicate subscription.",
        },
        async () => {
          await sleep(120);
          return "cancel-sub-b";
        },
      );

      await withToolCall(
        {
          name: "cancel_subscription",
          type: "http",
          argsSummary:
            '{"subscription_id":"sub_b","reason":"duplicate"}',
          inputContent: {
            subscription_id: "sub_b",
            reason: "duplicate",
          },
          extractOutputContent: () => ({
            status: "timeout",
            message: "Billing upstream timed out after 8000ms",
          }),
        },
        async () => {
          await sleep(260);
          throw new Error("Billing upstream timed out after 8000ms");
        },
      ).catch(() => undefined);

      await withLlmCall(
        {
          name: "explain-failure",
          provider: "simulated",
          requestModel: "demo-model",
          inputTokens: 620,
          outputTokens: 180,
          costMicros: 3100,
          inputSummary:
            "Explain the failed cancellation without claiming it succeeded.",
          outputSummary:
            "The cancellation could not be confirmed. A retry is required.",
        },
        async () => {
          await sleep(90);
          return "partial-response";
        },
      );

      run.setCost(9800, "USD");
      run.complete("failed", "error");
    },
  );
}

