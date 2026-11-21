from __future__ import annotations

import asyncio

from agent_ops import shutdown_tracing
from async_agent import run_async_example
from refund import run_refund_example
from shared import configure_examples
from tool_failure import run_tool_failure_example


def main() -> None:
    configure_examples()
    try:
        run_refund_example()
        run_tool_failure_example()
        asyncio.run(run_async_example())
        print("Emitted all Python example traces.")
    finally:
        shutdown_tracing()


if __name__ == "__main__":
    main()

