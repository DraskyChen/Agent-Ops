import {
  withAgentRun,
  withLlmCall,
} from "@agent-ops/sdk";
import OpenAI from "openai";

export async function runDeepSeekExample(): Promise<void> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (apiKey === undefined || apiKey === "") {
    throw new Error(
      "DEEPSEEK_API_KEY is required. Put it in the repository .env file or export it in your shell.",
    );
  }

  const model = process.env.DEEPSEEK_MODEL ?? "deepseek-flash";
  const baseURL = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";
  const client = new OpenAI({ apiKey, baseURL });
  const prompt =
    "You are an observability assistant. Explain in three concise bullet points why a failed tool call can be more useful than a successful overall run when debugging an agent.";
  const messages = [
    {
      role: "system",
      content:
        "Answer clearly for engineers who debug production AI agents.",
    },
    { role: "user", content: prompt },
  ] as const;

  const answer = await withAgentRun(
    {
      name: "deepseek-observability-agent",
      sessionId: `deepseek-example-${Date.now()}`,
      taskType: "support",
      inputSummary: prompt,
      inputContent: messages,
      extractOutputContent: (result) => result,
    },
    async (run) => {
      const completion = await withLlmCall(
        {
          name: "deepseek_chat",
          provider: "deepseek",
          requestModel: model,
          inputSummary: prompt,
          inputContent: messages,
          extractOutputContent: (response) =>
            response.choices[0]?.message.content,
          streaming: false,
          temperature: 0.2,
          extractTelemetry: (response) => {
            const usage = response.usage as
              | (typeof response.usage & {
                  prompt_cache_hit_tokens?: number;
                  prompt_cache_miss_tokens?: number;
                })
              | undefined;
            return {
              inputTokens: usage?.prompt_tokens,
              outputTokens: usage?.completion_tokens,
              cachedTokens: usage?.prompt_cache_hit_tokens,
              responseModel: response.model,
              outputSummary:
                response.choices[0]?.message.content ?? undefined,
              finishReasons: response.choices.map(
                (choice) => choice.finish_reason ?? "unknown",
              ),
              reasoningTokens:
                usage?.completion_tokens_details?.reasoning_tokens,
            };
          },
        },
        async () =>
          client.chat.completions.create({
            model,
            messages: [...messages],
            temperature: 0.2,
            stream: false,
          }),
      );

      const answer =
        completion.choices[0]?.message.content ??
        "DeepSeek returned no text content.";
      run.setOutputSummary(answer);
      run.complete("success", "final_answer");
      return answer;
    },
  );
  process.stdout.write(`${answer}\n`);
}

