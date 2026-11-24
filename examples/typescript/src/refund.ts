import { withAgentRun, withLlmCall, withToolCall } from "@agent-ops/sdk";

import { sleep } from "./shared.js";

export async function runRefundExample(): Promise<void> {
  const userInput =
    "Review refund request for order A-18421 and decide whether an automatic refund is allowed.";
  await withAgentRun(
    {
      name: "refund-agent",
      sessionId: `example-refund-${Date.now()}`,
      taskType: "refund",
      promptVersion: "refund-v12",
      evalCaseId: "refund-case-001",
      inputSummary: userInput,
      inputContent: { request: userInput },
      extractOutputContent: (result) => result,
    },
    async (run) => {
      const order = await withToolCall(
        {
          name: "query_order",
          type: "function",
          argsSummary: '{"order_id":"A-18421"}',
          outputSummary:
            '{"status":"delivered","purchased_at":"2026-11-13","amount":129}',
          inputContent: { order_id: "A-18421" },
          extractOutputContent: (result) => result,
        },
        async () => {
          await sleep(120);
          return { status: "delivered", amount: 129 };
        },
      );

      await withLlmCall(
        {
          name: "chat",
          provider: "simulated",
          requestModel: "demo-model",
          inputTokens: 1180,
          outputTokens: 82,
          costMicros: 4300,
          promptId: "refund-policy",
          promptVersion: "refund-v12",
          inputSummary:
            "You are a refund policy agent. Verify the order and apply the return policy.",
          outputSummary:
            "The order is delivered and inside the fourteen-day refund window.",
        },
        async () => {
          await sleep(160);
          return "eligible";
        },
      );

      await withLlmCall(
        {
          name: "final-response",
          provider: "simulated",
          requestModel: "demo-model",
          inputTokens: 420,
          outputTokens: 120,
          costMicros: 2100,
          inputSummary:
            "Write a concise confirmation using the verified order and refund policy.",
          outputSummary:
            `Your ${order.status} order is eligible for a full refund.`,
        },
        async () => {
          await sleep(110);
          return "refund-confirmed";
        },
      );

      run.setCost(6400, "USD");
      const response = `Your ${order.status} order is eligible for a full refund.`;
      run.setOutputSummary(response);
      run.complete("success", "final_answer");
      return response;
    },
  );
}

