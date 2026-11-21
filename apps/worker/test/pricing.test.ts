import { describe, expect, it } from "vitest";

import { calculateCostMicros, pricingTier } from "../src/pricing.js";

const flashOffPeak = {
  inputMicrosPerMillionTokens: 150_000n,
  outputMicrosPerMillionTokens: 600_000n,
  cachedInputMicrosPerMillionTokens: 3_000n,
};

describe("DeepSeek pricing", () => {
  it("uses peak pricing on weekday peak windows in UTC", () => {
    expect(pricingTier("deepseek", new Date("2026-11-23T02:00:00Z"))).toBe(
      "peak",
    );
    expect(pricingTier("deepseek", new Date("2026-11-23T05:00:00Z"))).toBe(
      "off_peak",
    );
    expect(pricingTier("deepseek", new Date("2026-11-21T02:00:00Z"))).toBe(
      "off_peak",
    );
  });

  it("prices cache-hit, cache-miss, and output tokens separately", () => {
    expect(
      calculateCostMicros({
        inputTokens: 1_000_000,
        cachedInputTokens: 500_000,
        outputTokens: 1_000_000,
        price: flashOffPeak,
      }),
    ).toBe(676_500n);
  });
});

