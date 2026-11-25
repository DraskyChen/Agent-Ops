import {
  withAgentRun,
  withLlmCall,
  withSubAgent,
  withToolCall,
} from "agent-ops-sdk";

import { sleep } from "./shared.js";

export async function runMultiAgentExample(): Promise<void> {
  await withAgentRun(
    {
      name: "lead-agent",
      sessionId: `example-multi-${Date.now()}`,
      taskType: "research",
      inputSummary:
        "Compare two vendors and ask a research worker to verify the pricing claims.",
    },
    async (run) => {
      await withLlmCall(
        {
          name: "delegate",
          provider: "simulated",
          requestModel: "demo-model",
          inputTokens: 980,
          outputTokens: 90,
          costMicros: 4100,
          inputSummary: "Plan the vendor comparison and delegate verification.",
          outputSummary:
            "Delegate source verification to the research worker.",
        },
        async () => {
          await sleep(90);
          return "delegate";
        },
      );

      await withSubAgent(
        {
          name: "research-worker",
          role: "source-verifier",
          inputSummary: "Verify the pricing claims for vendors A and B.",
          outputSummary:
            "Both claims are supported by the retrieved pricing pages.",
        },
        async () => {
          await withToolCall(
            {
              name: "fetch_pricing_page",
              type: "http",
              argsSummary: '{"vendors":["A","B"]}',
              outputSummary: "Two pricing pages fetched successfully.",
              inputContent: { vendors: ["A", "B"] },
              extractOutputContent: (result) => result,
            },
            async () => {
              await sleep(150);
              return "pricing-pages";
            },
          );

          await withLlmCall(
            {
              name: "verify_claims",
              provider: "simulated",
              requestModel: "demo-model",
              inputTokens: 1420,
              outputTokens: 210,
              costMicros: 5600,
              inputSummary:
                "Check the claims against the fetched pricing pages.",
              outputSummary: "The pricing claims are consistent with the sources.",
            },
            async () => {
              await sleep(170);
              return "verified";
            },
          );
        },
      );

      await withLlmCall(
        {
          name: "final_summary",
          provider: "simulated",
          requestModel: "demo-model",
          inputTokens: 860,
          outputTokens: 260,
          costMicros: 3700,
          inputSummary:
            "Write the final comparison using the verified research.",
          outputSummary:
            "Vendor A wins on high-volume cost; Vendor B is cheaper to start.",
        },
        async () => {
          await sleep(110);
          return "final-summary";
        },
      );

      run.setCost(13400, "USD");
      run.complete("success", "final_answer");
    },
  );
}

