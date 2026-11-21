from __future__ import annotations

from time import time_ns

from agent_ops import RunStatus, agent_run, llm_call, tool_call
from shared import sleep


def run_tool_failure_example() -> None:
    with agent_run(
        name="support-agent",
        session_id=f"python-support-{time_ns()}",
        task_type="support",
        prompt_version="support-v7",
        input_summary=(
            "Cancel the duplicate subscription and confirm the remaining "
            "account state."
        ),
    ) as run:
        run.capture_input_content(
            {
                "subscription_id": "sub_b",
                "question": "Cancel the duplicate subscription.",
            }
        )
        with llm_call(
            name="plan-cancellation",
            provider="simulated",
            request_model="demo-model",
            input_tokens=1540,
            output_tokens=98,
            cost_micros=6700,
            input_summary=(
                "Find both subscriptions and determine which one is active."
            ),
            output_summary=(
                "Call the billing tool to cancel the later duplicate subscription."
            ),
        ):
            sleep(120)

        try:
            with tool_call(
                name="cancel_subscription",
                tool_type="http",
                args_summary=(
                    '{"subscription_id":"sub_b","reason":"duplicate"}'
                ),
            ) as tool:
                tool.capture_input_content(
                    {
                        "subscription_id": "sub_b",
                        "reason": "duplicate",
                    }
                )
                sleep(260)
                raise RuntimeError("Billing upstream timed out after 8000ms")
        except RuntimeError:
            pass

        with llm_call(
            name="explain-failure",
            provider="simulated",
            request_model="demo-model",
            input_tokens=620,
            output_tokens=180,
            cost_micros=3100,
            input_summary=(
                "Explain the failed cancellation without claiming it succeeded."
            ),
            output_summary=(
                "The cancellation could not be confirmed. A retry is required."
            ),
        ):
            sleep(90)

        run.set_cost(9800, "USD")
        run.capture_output_content(
            "The cancellation could not be confirmed. A retry is required."
        )
        run.complete(RunStatus.FAILED, "error")


if __name__ == "__main__":
    from agent_ops import shutdown_tracing
    from shared import configure_examples

    configure_examples()
    try:
        run_tool_failure_example()
        print("Emitted tool-failure example trace.")
    finally:
        shutdown_tracing()

