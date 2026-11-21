export type PricingTier = "peak" | "off_peak" | "standard";

export interface TokenPrice {
  inputMicrosPerMillionTokens: bigint;
  outputMicrosPerMillionTokens: bigint;
  cachedInputMicrosPerMillionTokens: bigint;
}

export interface CostInput {
  inputTokens: number;
  cachedInputTokens?: number;
  outputTokens: number;
  price: TokenPrice;
}

export function pricingTier(provider: string, timestamp: Date): PricingTier {
  if (provider.toLowerCase() !== "deepseek") {
    return "standard";
  }

  const weekday = timestamp.getUTCDay();
  const minuteOfDay =
    timestamp.getUTCHours() * 60 + timestamp.getUTCMinutes();
  const isWeekday = weekday >= 1 && weekday <= 5;
  const isPeakWindow =
    (minuteOfDay >= 60 && minuteOfDay < 240) ||
    (minuteOfDay >= 360 && minuteOfDay < 600);

  return isWeekday && isPeakWindow ? "peak" : "off_peak";
}

export function calculateCostMicros(input: CostInput): bigint {
  const inputTokens = Math.max(0, Math.trunc(input.inputTokens));
  const outputTokens = Math.max(0, Math.trunc(input.outputTokens));
  const cachedInputTokens = Math.min(
    inputTokens,
    Math.max(0, Math.trunc(input.cachedInputTokens ?? 0)),
  );
  const cacheMissInputTokens = inputTokens - cachedInputTokens;

  return (
    proportionalCost(
      cacheMissInputTokens,
      input.price.inputMicrosPerMillionTokens,
    ) +
    proportionalCost(
      cachedInputTokens,
      input.price.cachedInputMicrosPerMillionTokens,
    ) +
    proportionalCost(outputTokens, input.price.outputMicrosPerMillionTokens)
  );
}

function proportionalCost(tokens: number, microsPerMillion: bigint): bigint {
  if (tokens === 0 || microsPerMillion === 0n) {
    return 0n;
  }
  const numerator = BigInt(tokens) * microsPerMillion;
  return (numerator + 500_000n) / 1_000_000n;
}

