from __future__ import annotations

import asyncio
from time import time_ns

from agent_ops import (
    RunStatus,
    async_agent_run,
    async_llm_call,
    async_tool_call,
)


async def run_async_example() -> None:
    async with async_agent_run(
        name="async-support-agent",
        session_id=f"python-async-{time_ns()}",
        task_type="support",
        input_summary="Look up the subscription and explain its current state.",
    ) as run:
        async with async_tool_call(
            name="get_subscription",
            tool_type="function",
            args_summary='{"customer_id":"cus_7021"}',
            output_summary='{"status":"canceled","active_until":"2026-11-30"}',
        ):
            await asyncio.sleep(0.12)

        async with async_llm_call(
            name="chat",
            provider="simulated",
            request_model="demo-model",
            input_tokens=780,
            output_tokens=142,
            cost_micros=2700,
            input_summary="Answer using the subscription state returned by the tool.",
            output_summary=(
                "Your subscription is cancelled. You can continue using it "
                "until November 30."
            ),
        ):
            await asyncio.sleep(0.16)

        run.set_cost(2700, "USD")
        run.complete(RunStatus.SUCCESS, "final_answer")


if __name__ == "__main__":
    from agent_ops import shutdown_tracing
    from shared import configure_examples

    configure_examples()
    try:
        asyncio.run(run_async_example())
        print("Emitted async example trace.")
    finally:
        shutdown_tracing()

