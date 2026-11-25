import assert from "node:assert/strict";
import { createServer } from "node:http";

import {
  ATTR,
  SCHEMA_VERSION,
  SDK_VERSION,
  configureTracing,
  normalizeSpanType,
  normalizeTaskType,
  shutdownTracing,
  withAgentRun,
  withLlmCall,
  withToolCall,
} from "agent-ops-sdk";

const mode = process.argv[2] ?? "success";
assert.ok(mode === "success" || mode === "failure", `Unknown mode ${mode}`);
assert.equal(SCHEMA_VERSION, "0.1");
assert.equal(normalizeSpanType("custom.extension"), "custom");
assert.equal(normalizeTaskType("custom_extension"), "other");

const capturedBodies = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    capturedBodies.push(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    );
    response.writeHead(mode === "success" ? 201 : 503, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify(
        mode === "success"
          ? { contentId: "content-smoke" }
          : { code: "CONTENT_UNAVAILABLE" },
      ),
    );
  });
});

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const address = server.address();
assert.ok(address !== null && typeof address === "object");
const contentEndpoint = `http://127.0.0.1:${address.port}/api/v1/content`;
const spans = [];
const exporter = {
  export(batch, callback) {
    spans.push(...batch);
    callback({ code: 0 });
  },
  shutdown() {
    return Promise.resolve();
  },
  forceFlush() {
    return Promise.resolve();
  },
};

try {
  await configureTracing({
    serviceName: "sdk-package-smoke",
    serviceVersion: "1.0.0",
    appName: "sdk-package-smoke",
    environment: "test",
    endpoint: "http://127.0.0.1:4318/v1/traces",
    spanExporter: exporter,
    simpleExporter: true,
    autoDetectResources: false,
    contentCapture: "full",
    contentEndpoint,
    contentTimeoutMs: 200,
  });

  await withAgentRun(
    {
      sessionId: "sdk-package-smoke",
      taskType: "support",
      inputSummary: "user=smoke@example.com",
      inputContent: { email: "smoke@example.com" },
      extractOutputContent: (result) => result,
    },
    async (run) => {
      await withLlmCall(
        {
          provider: "smoke",
          requestModel: "smoke-model",
          inputTokens: 10,
          outputTokens: 2,
        },
        async () => "ok",
      );

      try {
        await withToolCall(
          { name: "smoke_tool", argsSummary: '{"case":"failure"}' },
          async () => {
            throw new Error("expected smoke failure");
          },
        );
      } catch {
        // The failed tool must not prevent the run from completing.
      }

      run.complete("success", "final_answer");
      return "smoke-output";
    },
  );
} finally {
  await shutdownTracing();
  await new Promise((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
}

assert.ok(capturedBodies.length > 0, "content capture request was not sent");
assert.equal(capturedBodies[0].ownerApp, "sdk-package-smoke");
assert.equal(capturedBodies[0].content.includes("smoke@example.com"), false);
assert.equal(capturedBodies[0].content.includes("[REDACTED_EMAIL]"), true);

const root = requiredSpan(spans, "agent.run");
const llm = requiredSpan(spans, "chat");
const tool = requiredSpan(spans, "smoke_tool");
assert.equal(root.attributes[ATTR.agentRunStatus], "success");
assert.equal(root.resource.attributes["agent.sdk.version"], SDK_VERSION);
assert.equal(llm.parentSpanContext?.spanId, root.spanContext().spanId);
assert.equal(tool.parentSpanContext?.spanId, root.spanContext().spanId);
assert.equal(llm.spanContext().traceId, root.spanContext().traceId);
assert.equal(tool.spanContext().traceId, root.spanContext().traceId);
assert.equal(tool.attributes[ATTR.agentErrorCategory], "tool");

if (mode === "success") {
  assert.equal(root.attributes[ATTR.agentInputRef], "content-smoke");
  assert.equal(root.attributes[ATTR.agentContentRecorded], "full");
} else {
  assert.equal(root.attributes[ATTR.agentInputRef], undefined);
}

process.stdout.write(`TypeScript SDK ${SDK_VERSION} ${mode} smoke passed.\n`);

function requiredSpan(candidates, name) {
  const span = candidates.find((candidate) => candidate.name === name);
  if (span === undefined) {
    throw new Error(`Missing span ${name}`);
  }
  return span;
}
