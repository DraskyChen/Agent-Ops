import { describe, expect, it } from "vitest";

import {
  ATTR,
  ENUMS,
  SCHEMA_VERSION,
  TASK_TYPES,
  assertSupportedSchemaVersion,
  normalizeSpanType,
  normalizeTaskType,
} from "../src/index.js";

describe("Agent Ops contracts", () => {
  it("exports the stable v0.1 identifiers", () => {
    expect(SCHEMA_VERSION).toBe("0.1");
    expect(ATTR.agentSpanType).toBe("agent.span.type");
    expect(ATTR.genAiRequestModel).toBe("gen_ai.request.model");
    expect(ATTR.agentEvalCaseId).toBe("agent.eval.case_id");
    expect(ENUMS.spanType).toContain("agent.run");
    expect(ENUMS.contentStatus).toContain("expired");
    expect(TASK_TYPES).toContain("refund");
  });

  it("normalizes unknown extension values without rejecting the span", () => {
    expect(normalizeSpanType("workflow.node")).toBe("custom");
    expect(normalizeTaskType("unregistered_task")).toBe("other");
  });

  it("accepts the current major schema version", () => {
    expect(() => assertSupportedSchemaVersion("0.1")).not.toThrow();
    expect(() => assertSupportedSchemaVersion("1.0")).toThrow(
      /Unsupported Agent Ops schema/,
    );
  });
});

