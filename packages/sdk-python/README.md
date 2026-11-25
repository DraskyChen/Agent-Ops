# Agent Ops Python SDK

OpenTelemetry tracing helpers for Python agents that send traces to Agent Ops.

## Requirements

- Python 3.11 or newer
- An Agent Ops OTLP endpoint and ingest token

## Install

```bash
pip install agent-ops-sdk
```

## Quick start

```python
import os

from agent_ops import (
    Environment,
    TracingConfig,
    agent_run,
    configure_tracing,
    llm_call,
    shutdown_tracing,
    tool_call,
)

configure_tracing(
    TracingConfig(
        service_name="support-agent",
        service_version="1.4.0",
        app_name="customer-support",
        environment=Environment.PROD,
        endpoint="https://agent-ops.example.com/v1/traces",
        headers={
            "authorization": f"Bearer {os.environ['AGENT_OPS_INGEST_TOKEN']}"
        },
    )
)

try:
    with agent_run(
        session_id="session-123",
        task_type="support",
        input_summary="Resolve a duplicate subscription",
    ) as run:
        with llm_call(
            provider="deepseek",
            request_model="deepseek-flash",
            input_tokens=420,
            output_tokens=80,
        ):
            pass

        with tool_call(
            name="cancel_subscription",
            args_summary='{"subscriptionId":"sub-b"}',
        ):
            pass

        run.complete("success", "final_answer")
finally:
    shutdown_tracing()
```

To capture complete input and output content, set `content_capture=True` and
provide `content_token`. Captured content is redacted and uploaded through the
Agent Ops server before its content ID is attached to the span.

The package exposes `__version__`, contract constants such as `Attr`, and
helpers for `agent.run`, `llm.call`, `tool.call`, `retrieval`, and `sub_agent`
spans.

## License

Apache-2.0. See [LICENSE](LICENSE).
