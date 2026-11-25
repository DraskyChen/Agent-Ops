import { shutdownTracing } from "agent-ops-sdk";

import { runDeepSeekExample } from "./deepseek.js";
import { runMultiAgentExample } from "./multi-agent.js";
import { runRefundExample } from "./refund.js";
import { runRetrievalExample } from "./retrieval.js";
import { configureExamples, sleep } from "./shared.js";
import { runToolFailureExample } from "./tool-failure.js";

const simulatedExamples = {
  refund: runRefundExample,
  "tool-failure": runToolFailureExample,
  retrieval: runRetrievalExample,
  "multi-agent": runMultiAgentExample,
} as const;

const examples = {
  ...simulatedExamples,
  deepseek: runDeepSeekExample,
} as const;

type ExampleName = keyof typeof examples;

const requested = process.argv[2];

await configureExamples();

try {
  if (requested === undefined || requested === "all") {
    for (const runExample of Object.values(simulatedExamples)) {
      await runExample();
      await sleep(220);
    }
  } else if (isExampleName(requested)) {
    await examples[requested]();
  } else {
    throw new Error(
      `Unknown example "${requested}". Use ${Object.keys(examples).join(", ")}`,
    );
  }
  process.stdout.write(
    `Emitted ${requested ?? "all"} example trace(s).\n`,
  );
} finally {
  await shutdownTracing();
}

function isExampleName(value: string): value is ExampleName {
  return Object.hasOwn(examples, value);
}

