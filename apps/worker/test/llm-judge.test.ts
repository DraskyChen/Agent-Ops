import { describe, expect, it } from "vitest";

import {
  buildJudgePrompt,
  parseJudgeDecision,
} from "../src/domain/llm-judge.js";

describe("LLM judge domain", () => {
  it("builds a data-delimited prompt and parses the fixed response schema", () => {
    const prompt = buildJudgePrompt(
      {
        name: "judge",
        version: 1,
        kind: "llm_judge",
        config: {
          model: "deepseek-flash",
          rubric: "Require a complete, grounded response.",
          allowExternalContent: true,
        },
      },
      {
        input: "Refund order 123",
        expectedOutput: "Refund completed",
        expectedBehavior: "Use the order tool before claiming success",
        candidateOutput: "Refund completed",
      },
    );

    expect(prompt.system).toContain("Return exactly one JSON object");
    expect(prompt.user).toContain("## Rubric");
    expect(prompt.user).toContain("Refund order 123");
    expect(parseJudgeDecision(
      '{"score":1,"pass":true,"reason":"Matches the reference","category":"correct"}',
    )).toEqual({
      score: 1,
      pass: true,
      reason: "Matches the reference",
      category: "correct",
    });
  });

  it("rejects inconsistent or unsafe judge payloads", () => {
    expect(() =>
      parseJudgeDecision(
        '{"score":0.2,"pass":true,"reason":"wrong","category":"incorrect"}',
      ),
    ).toThrow(/threshold/);
    expect(() =>
      parseJudgeDecision(
        '{"score":0.2,"pass":false,"reason":"wrong","category":"unknown"}',
      ),
    ).toThrow(/category/);
  });
});
