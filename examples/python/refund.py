from __future__ import annotations

from time import time_ns

from agent_ops import RunStatus, agent_run, llm_call, tool_call
from shared import sleep


def run_refund_example() -> None:
    run_id = time_ns()
    with agent_run(
        name="refund-agent",
        session_id=f"python-refund-{run_id}",
        task_type="refund",
        prompt_version="refund-v12",
        input_summary=(
            "Review refund request for order A-18421 and decide whether an "
            "automatic refund is allowed."
        ),
    ) as run:
        run.capture_input_content(
            {
                "order_id": "A-18421",
                "question": "Review refund eligibility.",
            }
        )
        with tool_call(
            name="query_order",
            tool_type="function",
            args_summary='{"order_id":"A-18421"}',
            output_summary=(
                '{"status":"delivered","purchased_at":"2026-11-13",'
                '"amount":129}'
            ),
        ) as tool:
            tool.capture_input_content({"order_id": "A-18421"})
            sleep(120)
            tool.capture_output_content(
                {
                    "status": "delivered",
                    "purchased_at": "2026-11-13",
                    "amount": 129,
                }
            )

        with llm_call(
            name="chat",
            provider="simulated",
            request_model="demo-model",
            input_tokens=1180,
            output_tokens=82,
            cost_micros=4300,
            prompt_id="refund-policy",
            prompt_version="refund-v12",
            input_summary=(
                "You are a refund policy agent. Verify the order and apply "
                "the return policy."
            ),
            output_summary=(
                "The order is delivered and inside the fourteen-day refund window."
            ),
        ):
            sleep(160)

        with llm_call(
            name="final-response",
            provider="simulated",
            request_model="demo-model",
            input_tokens=420,
            output_tokens=120,
            cost_micros=2100,
            input_summary=(
                "Write a concise confirmation using the verified order and "
                "refund policy."
            ),
            output_summary=(
                "Your delivered order is eligible for a full refund."
            ),
        ):
            sleep(110)

        run.set_cost(6400, "USD")
        run.capture_output_content(
            "The delivered order is eligible for a full refund."
        )
        run.complete(RunStatus.SUCCESS, "final_answer")


if __name__ == "__main__":
    from agent_ops import shutdown_tracing
    from shared import configure_examples

    configure_examples()
    try:
        run_refund_example()
        print("Emitted refund example trace.")
    finally:
        shutdown_tracing()

