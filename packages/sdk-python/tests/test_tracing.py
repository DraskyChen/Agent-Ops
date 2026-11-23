from __future__ import annotations

from collections.abc import Iterator

import pytest
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (
    InMemorySpanExporter,
)

from agent_ops import (
    AgentRunHandle,
    Attr,
    Environment,
    TracingConfig,
    agent_run,
    configure_tracing,
    llm_call,
    shutdown_tracing,
    tool_call,
)
from agent_ops.attributes import redact


@pytest.fixture(scope="module")
def span_exporter() -> Iterator[InMemorySpanExporter]:
    exporter = InMemorySpanExporter()
    configure_tracing(
        TracingConfig(
            service_name="test-agent",
            service_version="1.2.3",
            app_name="agent-ops-tests",
            environment=Environment.TEST,
            endpoint="http://127.0.0.1:4318/v1/traces",
            span_exporter=exporter,
            simple_exporter=True,
        )
    )
    yield exporter
    shutdown_tracing()


def test_agent_llm_and_failed_tool_spans_share_one_trace(
    span_exporter: InMemorySpanExporter,
) -> None:
    span_exporter.clear()

    with agent_run(
        session_id="session-1",
        task_type="refund",
        eval_case_id="refund-case-001",
        input_summary="user=alice@example.com phone=13800138000",
    ) as run:
        assert isinstance(run, AgentRunHandle)
        with llm_call(
            provider="test-provider",
            request_model="test-model",
            input_tokens=120,
            output_tokens=30,
        ):
            pass

        with pytest.raises(RuntimeError, match="tool failed"):
            with tool_call(
                name="query_order",
                args_summary="order=12346",
            ):
                raise RuntimeError("tool failed")

        run.complete("success", "final_answer")

    spans = span_exporter.get_finished_spans()
    by_name = {span.name: span for span in spans}
    root = by_name["agent.run"]
    llm = by_name["chat"]
    tool = by_name["query_order"]

    assert root.attributes[Attr.AGENT_SPAN_TYPE] == "agent.run"
    assert root.attributes[Attr.AGENT_RUN_STATUS] == "success"
    assert root.attributes[Attr.AGENT_RUN_STOP_REASON] == "final_answer"
    assert root.attributes[Attr.AGENT_EVAL_CASE_ID] == "refund-case-001"
    assert root.attributes[Attr.AGENT_INPUT_SUMMARY] == (
        "user=[REDACTED_EMAIL] phone=[REDACTED_PHONE]"
    )
    assert llm.parent is not None
    assert tool.parent is not None
    assert llm.parent.span_id == root.context.span_id
    assert tool.parent.span_id == root.context.span_id
    assert llm.context.trace_id == root.context.trace_id
    assert tool.context.trace_id == root.context.trace_id
    assert tool.attributes[Attr.AGENT_ERROR_CATEGORY] == "tool"
    assert tool.status.status_code.name == "ERROR"


def test_redaction_covers_common_sensitive_values() -> None:
    assert redact(
        "alice@example.com 13800138000 Bearer abcdefghijk sk-secret12345"
    ) == (
        "[REDACTED_EMAIL] [REDACTED_PHONE] "
        "Bearer [REDACTED_TOKEN] [REDACTED_API_KEY]"
    )
