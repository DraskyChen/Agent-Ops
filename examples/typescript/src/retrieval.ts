import { withAgentRun, withLlmCall, withRetrieval } from "@agent-ops/sdk";

import { sleep } from "./shared.js";

export async function runRetrievalExample(): Promise<void> {
  await withAgentRun(
    {
      name: "research-agent",
      sessionId: `example-research-${Date.now()}`,
      taskType: "research",
      inputSummary:
        "Summarize how the three leading vendors price overage usage.",
    },
    async (run) => {
      await withRetrieval(
        {
          name: "search_pricing_docs",
          source: "internal-docs",
          query: "vendor overage pricing included usage",
          topK: 5,
          resultCount: 3,
          documentIds: ["pricing-a", "pricing-b", "pricing-c"],
          scores: [0.94, 0.88, 0.81],
          inputSummary: "vendor overage pricing included usage",
          outputSummary: "Three pricing documents matched the query.",
        },
        async () => {
          await sleep(180);
          return ["pricing-a", "pricing-b", "pricing-c"];
        },
      );

      await withLlmCall(
        {
          name: "write_comparison",
          provider: "simulated",
          requestModel: "demo-model",
          inputTokens: 2260,
          outputTokens: 540,
          costMicros: 9200,
          inputSummary:
            "Compare included usage and overage rates across the retrieved documents.",
          outputSummary:
            "Vendor B has the lowest entry price, while Vendor A is cheaper at high volume.",
        },
        async () => {
          await sleep(220);
          return "comparison";
        },
      );

      run.setCost(9200, "USD");
      run.complete("success", "final_answer");
    },
  );
}

