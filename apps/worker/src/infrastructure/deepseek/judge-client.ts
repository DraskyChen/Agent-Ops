import type {
  JudgeClient,
} from "../../application/judge-client.js";

export interface DeepSeekJudgeClientConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
}

export function createDeepSeekJudgeClient(
  config: DeepSeekJudgeClientConfig,
): JudgeClient {
  return {
    async evaluate(input) {
      const response = await fetch(
        `${config.baseUrl.replace(/\/+$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          body: JSON.stringify({
            model: input.model,
            messages: [
              { role: "system", content: input.system },
              { role: "user", content: input.user },
            ],
            temperature: input.temperature ?? 0,
            max_tokens: 1000,
            response_format: { type: "json_object" },
          }),
          signal: AbortSignal.timeout(config.timeoutMs),
        },
      );
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        throw new Error(
          `DeepSeek Judge failed with HTTP ${response.status}: ${detail}`,
        );
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
        usage?: {
          prompt_tokens?: unknown;
          completion_tokens?: unknown;
        };
      };
      const content = body.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim() === "") {
        throw new Error("DeepSeek Judge returned no content");
      }
      return {
        content,
        inputTokens: numberOrNull(body.usage?.prompt_tokens),
        outputTokens: numberOrNull(body.usage?.completion_tokens),
      };
    },
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
