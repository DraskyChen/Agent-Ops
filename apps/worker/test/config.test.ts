import { describe, expect, it } from "vitest";

import { loadWorkerConfig } from "../src/config.js";

describe("worker Judge configuration", () => {
  it("keeps external Judge disabled by default", () => {
    const config = loadWorkerConfig({});
    expect(config.evaluationJudgeEnabled).toBe(false);
    expect(config.deepseek.apiKey).toBeNull();
  });

  it("requires an API key when external Judge is enabled", () => {
    expect(() =>
      loadWorkerConfig({ EVALUATION_JUDGE_ENABLED: "true" }),
    ).toThrow(/DEEPSEEK_API_KEY/);

    const config = loadWorkerConfig({
      EVALUATION_JUDGE_ENABLED: "true",
      DEEPSEEK_API_KEY: "test-key",
      DEEPSEEK_MODEL: "deepseek-flash",
    });
    expect(config.evaluationJudgeEnabled).toBe(true);
    expect(config.deepseek.apiKey).toBe("test-key");
    expect(config.deepseek.model).toBe("deepseek-flash");
  });
});
