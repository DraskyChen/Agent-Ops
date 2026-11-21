from __future__ import annotations

import os
from pathlib import Path
from time import time_ns

from agent_ops import RunStatus, agent_run, llm_call, shutdown_tracing
from dotenv import load_dotenv
from openai import OpenAI
from shared import configure_examples

load_dotenv(Path(__file__).resolve().parents[2] / ".env")


def run_deepseek_example() -> None:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError(
            "DEEPSEEK_API_KEY is required. Put it in the repository .env "
            "file or export it in your shell."
        )

    model = os.getenv("DEEPSEEK_MODEL", "deepseek-flash")
    base_url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
    client = OpenAI(api_key=api_key, base_url=base_url)
    prompt = (
        "You are an observability assistant. Explain in three concise bullet "
        "points why a failed tool call can be more useful than a successful "
        "overall run when debugging an agent."
    )
    messages = [
        {
            "role": "system",
            "content": (
                "Answer clearly for engineers who debug production AI agents."
            ),
        },
        {"role": "user", "content": prompt},
    ]

    with agent_run(
        name="deepseek-observability-agent",
        session_id=f"python-deepseek-{time_ns()}",
        task_type="support",
        input_summary=prompt,
    ) as run:
        run.capture_input_content(messages)
        with llm_call(
            name="deepseek_chat",
            provider="deepseek",
            request_model=model,
            input_summary=prompt,
            streaming=False,
            temperature=0.2,
        ) as call:
            call.capture_input_content(messages)
            completion = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.2,
                stream=False,
            )
            usage = completion.usage
            details = usage.completion_tokens_details if usage else None
            answer = (
                completion.choices[0].message.content
                if completion.choices
                else None
            ) or "DeepSeek returned no text content."
            call.record_usage(
                input_tokens=usage.prompt_tokens if usage else None,
                output_tokens=usage.completion_tokens if usage else None,
                cached_tokens=(
                    getattr(usage, "prompt_cache_hit_tokens", None)
                    if usage
                    else None
                ),
                response_model=completion.model,
                finish_reasons=[
                    choice.finish_reason or "unknown"
                    for choice in completion.choices
                ],
                reasoning_tokens=(
                    details.reasoning_tokens if details else None
                ),
                streaming=False,
                output_summary=answer,
            )
            call.capture_output_content(answer)

        run.set_output_summary(answer)
        run.capture_output_content(answer)
        run.complete(RunStatus.SUCCESS, "final_answer")
        print(answer)


if __name__ == "__main__":
    configure_examples()
    try:
        run_deepseek_example()
    finally:
        shutdown_tracing()

