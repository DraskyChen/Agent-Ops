from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from contextlib import asynccontextmanager, contextmanager
from contextvars import Token
from dataclasses import dataclass
from typing import Any

from opentelemetry import context as otel_context
from opentelemetry import trace
from opentelemetry.trace import Span, Status, StatusCode

from .attributes import common_attributes, record_error, summarize
from .content import capture_content
from .generated import Attr, ErrorCategory, RunStatus, ToolType
from .runtime import get_tracer


class _ContentCaptureMixin:
    _span: Span
    _content_prefix: str

    def capture_input_content(
        self,
        content: object,
    ) -> str | None:
        return _capture_span_content(
            self._span,
            f"{self._content_prefix}_input",
            Attr.AGENT_INPUT_REF,
            content,
        )

    def capture_output_content(
        self,
        content: object,
    ) -> str | None:
        return _capture_span_content(
            self._span,
            f"{self._content_prefix}_output",
            Attr.AGENT_OUTPUT_REF,
            content,
        )


@dataclass(slots=True)
class AgentRunHandle(_ContentCaptureMixin):
    _span: Span
    status: RunStatus | None = None
    stop_reason: str | None = None
    _content_prefix: str = "agent"

    def complete(self, status: RunStatus | str, stop_reason: str | None = None) -> None:
        self.status = status if isinstance(status, RunStatus) else RunStatus(status)
        self.stop_reason = stop_reason

    def set_user_id(self, user_id: str) -> None:
        self._span.set_attribute(Attr.AGENT_USER_ID, user_id)

    def set_cost(self, cost_micros: int, currency: str) -> None:
        self._span.set_attribute(Attr.AGENT_RUN_COST_TOTAL, cost_micros)
        self._span.set_attribute(Attr.AGENT_COST_CURRENCY, currency)

    def set_output_summary(self, output_summary: str) -> None:
        self._span.set_attribute(
            Attr.AGENT_OUTPUT_SUMMARY,
            summarize(output_summary) or "",
        )


@dataclass(slots=True)
class LlmCallHandle(_ContentCaptureMixin):
    _span: Span
    _content_prefix: str = "llm"

    def record_usage(
        self,
        *,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        response_model: str | None = None,
        finish_reasons: list[str] | None = None,
        cached_tokens: int | None = None,
        reasoning_tokens: int | None = None,
        ttft_ms: int | None = None,
        streaming: bool | None = None,
        retry_count: int | None = None,
        cost_micros: int | None = None,
        output_summary: str | None = None,
    ) -> None:
        _set_optional(
            self._span,
            Attr.AGENT_OUTPUT_SUMMARY,
            summarize(output_summary),
        )
        _set_optional(self._span, Attr.GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
        _set_optional(self._span, Attr.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
        _set_optional(self._span, Attr.GEN_AI_RESPONSE_MODEL, response_model)
        _set_optional(
            self._span,
            Attr.GEN_AI_RESPONSE_FINISH_REASONS,
            finish_reasons,
        )
        _set_optional(self._span, Attr.AGENT_LLM_TOKENS_CACHED, cached_tokens)
        _set_optional(
            self._span,
            Attr.AGENT_LLM_TOKENS_REASONING,
            reasoning_tokens,
        )
        _set_optional(self._span, Attr.AGENT_LLM_TTFT_MS, ttft_ms)
        _set_optional(self._span, Attr.AGENT_LLM_STREAMING, streaming)
        _set_optional(self._span, Attr.AGENT_LLM_RETRY_COUNT, retry_count)
        _set_optional(self._span, Attr.AGENT_LLM_COST, cost_micros)


@dataclass(slots=True)
class ToolCallHandle(_ContentCaptureMixin):
    _span: Span
    _content_prefix: str = "tool"


@contextmanager
def agent_run(
    *,
    name: str = "agent.run",
    session_id: str,
    task_type: str,
    run_id: str | None = None,
    user_id: str | None = None,
    prompt_version: str | None = None,
    content_recorded: str = "metadata_only",
    input_summary: str | None = None,
    output_summary: str | None = None,
    input_ref: str | None = None,
    output_ref: str | None = None,
) -> Iterator[AgentRunHandle]:
    attributes = common_attributes(
        "agent.run",
        content_recorded=content_recorded,
        input_summary=input_summary,
        output_summary=output_summary,
        input_ref=input_ref,
        output_ref=output_ref,
    )
    attributes[Attr.AGENT_SESSION_ID] = session_id
    attributes[Attr.AGENT_TASK_TYPE] = task_type
    _set_optional(attributes, Attr.AGENT_RUN_ID, run_id)
    _set_optional(attributes, Attr.AGENT_USER_ID, user_id)
    _set_optional(attributes, Attr.AGENT_PROMPT_VERSION, prompt_version)

    span = get_tracer().start_span(name, attributes=attributes)
    token = _attach(span)
    handle = AgentRunHandle(_span=span)
    try:
        yield handle
    except BaseException as error:
        span.set_attributes(
            {
                Attr.AGENT_RUN_STATUS: RunStatus.FAILED.value,
                Attr.AGENT_RUN_STOP_REASON: "error",
            }
        )
        span.set_status(Status(StatusCode.ERROR, str(error)))
        record_error(span, error)
        raise
    else:
        final_status = handle.status or RunStatus.PARTIAL
        span.set_attribute(Attr.AGENT_RUN_STATUS, final_status.value)
        _set_optional(span, Attr.AGENT_RUN_STOP_REASON, handle.stop_reason)
        span.set_status(
            Status(
                StatusCode.OK
                if final_status is RunStatus.SUCCESS
                else StatusCode.ERROR,
                None if final_status is RunStatus.SUCCESS else final_status.value,
            )
        )
    finally:
        otel_context.detach(token)
        span.end()


@asynccontextmanager
async def async_agent_run(
    **options: Any,
) -> AsyncIterator[AgentRunHandle]:
    with agent_run(**options) as handle:
        yield handle


@contextmanager
def llm_call(
    *,
    name: str = "chat",
    provider: str,
    request_model: str,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    response_model: str | None = None,
    temperature: float | None = None,
    top_p: float | None = None,
    max_tokens: int | None = None,
    finish_reasons: list[str] | None = None,
    cached_tokens: int | None = None,
    reasoning_tokens: int | None = None,
    ttft_ms: int | None = None,
    streaming: bool | None = None,
    retry_count: int | None = None,
    prompt_id: str | None = None,
    prompt_version: str | None = None,
    cost_micros: int | None = None,
    **common: Any,
) -> Iterator[LlmCallHandle]:
    attributes = common_attributes("llm.call", **common)
    attributes[Attr.GEN_AI_PROVIDER_NAME] = provider
    attributes[Attr.GEN_AI_REQUEST_MODEL] = request_model
    _set_optional(attributes, Attr.GEN_AI_USAGE_INPUT_TOKENS, input_tokens)
    _set_optional(attributes, Attr.GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens)
    _set_optional(attributes, Attr.GEN_AI_RESPONSE_MODEL, response_model)
    _set_optional(attributes, Attr.GEN_AI_REQUEST_TEMPERATURE, temperature)
    _set_optional(attributes, Attr.GEN_AI_REQUEST_TOP_P, top_p)
    _set_optional(attributes, Attr.GEN_AI_REQUEST_MAX_TOKENS, max_tokens)
    _set_optional(
        attributes,
        Attr.GEN_AI_RESPONSE_FINISH_REASONS,
        finish_reasons,
    )
    _set_optional(attributes, Attr.AGENT_LLM_TOKENS_CACHED, cached_tokens)
    _set_optional(attributes, Attr.AGENT_LLM_TOKENS_REASONING, reasoning_tokens)
    _set_optional(attributes, Attr.AGENT_LLM_TTFT_MS, ttft_ms)
    _set_optional(attributes, Attr.AGENT_LLM_STREAMING, streaming)
    _set_optional(attributes, Attr.AGENT_LLM_RETRY_COUNT, retry_count)
    _set_optional(attributes, Attr.AGENT_PROMPT_ID, prompt_id)
    _set_optional(attributes, Attr.AGENT_PROMPT_VERSION, prompt_version)
    _set_optional(attributes, Attr.AGENT_LLM_COST, cost_micros)
    with _span_handle(name, attributes, ErrorCategory.MODEL) as handle:
        yield handle


@contextmanager
def tool_call(
    *,
    name: str,
    tool_type: ToolType | str | None = None,
    call_id: str | None = None,
    args_summary: str | None = None,
    retry_count: int | None = None,
    **common: Any,
) -> Iterator[ToolCallHandle]:
    attributes = common_attributes("tool.call", **common)
    attributes[Attr.AGENT_TOOL_NAME] = name
    _set_optional(attributes, Attr.AGENT_TOOL_TYPE, _enum_value(tool_type))
    _set_optional(attributes, Attr.AGENT_TOOL_CALL_ID, call_id)
    _set_optional(attributes, Attr.AGENT_TOOL_RETRY_COUNT, retry_count)
    _set_optional(attributes, Attr.AGENT_TOOL_ARGS_SUMMARY, summarize(args_summary))
    with _tool_span_handle(name, attributes) as handle:
        yield handle


@contextmanager
def retrieval(
    *,
    name: str = "retrieval",
    source: str | None = None,
    query: str | None = None,
    top_k: int | None = None,
    result_count: int | None = None,
    document_ids: list[str] | None = None,
    scores: list[float] | None = None,
    **common: Any,
) -> Iterator[None]:
    attributes = common_attributes("retrieval", **common)
    _set_optional(attributes, Attr.AGENT_RETRIEVAL_SOURCE, source)
    _set_optional(
        attributes,
        Attr.AGENT_RETRIEVAL_QUERY_SUMMARY,
        summarize(query),
    )
    _set_optional(attributes, Attr.AGENT_RETRIEVAL_TOP_K, top_k)
    _set_optional(attributes, Attr.AGENT_RETRIEVAL_RESULT_COUNT, result_count)
    _set_optional(
        attributes,
        Attr.AGENT_RETRIEVAL_DOC_IDS,
        document_ids[:20] if document_ids is not None else None,
    )
    _set_optional(
        attributes,
        Attr.AGENT_RETRIEVAL_SCORES,
        scores[:20] if scores is not None else None,
    )
    with _span(name, attributes, ErrorCategory.OTHER):
        yield


@contextmanager
def sub_agent(
    *,
    name: str,
    role: str | None = None,
    **common: Any,
) -> Iterator[None]:
    attributes = common_attributes("sub_agent", **common)
    attributes[Attr.AGENT_SUB_AGENT_NAME] = name
    _set_optional(attributes, Attr.AGENT_SUB_AGENT_ROLE, role)
    with _span(name, attributes, ErrorCategory.OTHER):
        yield


@asynccontextmanager
async def async_llm_call(**options: Any) -> AsyncIterator[LlmCallHandle]:
    with llm_call(**options) as handle:
        yield handle


@asynccontextmanager
async def async_tool_call(**options: Any) -> AsyncIterator[ToolCallHandle]:
    with tool_call(**options) as handle:
        yield handle


@asynccontextmanager
async def async_retrieval(**options: Any) -> AsyncIterator[None]:
    with retrieval(**options):
        yield


@asynccontextmanager
async def async_sub_agent(**options: Any) -> AsyncIterator[None]:
    with sub_agent(**options):
        yield


def current_trace_id() -> str | None:
    span = trace.get_current_span()
    span_context = span.get_span_context()
    return f"{span_context.trace_id:032x}" if span_context.is_valid else None


def current_span_id() -> str | None:
    span = trace.get_current_span()
    span_context = span.get_span_context()
    return f"{span_context.span_id:016x}" if span_context.is_valid else None


@contextmanager
def _span(
    name: str,
    attributes: dict[str, Any],
    category: ErrorCategory,
) -> Iterator[None]:
    span = get_tracer().start_span(name, attributes=attributes)
    token = _attach(span)
    try:
        yield
    except BaseException as error:
        span.set_status(Status(StatusCode.ERROR, str(error)))
        record_error(span, error, category)
        raise
    else:
        span.set_status(Status(StatusCode.OK))
    finally:
        otel_context.detach(token)
        span.end()


@contextmanager
def _span_handle(
    name: str,
    attributes: dict[str, Any],
    category: ErrorCategory,
) -> Iterator[LlmCallHandle]:
    span = get_tracer().start_span(name, attributes=attributes)
    token = _attach(span)
    handle = LlmCallHandle(_span=span)
    try:
        yield handle
    except BaseException as error:
        span.set_status(Status(StatusCode.ERROR, str(error)))
        record_error(span, error, category)
        raise
    else:
        span.set_status(Status(StatusCode.OK))
    finally:
        otel_context.detach(token)
        span.end()


@contextmanager
def _tool_span_handle(
    name: str,
    attributes: dict[str, Any],
) -> Iterator[ToolCallHandle]:
    span = get_tracer().start_span(name, attributes=attributes)
    token = _attach(span)
    handle = ToolCallHandle(_span=span)
    try:
        yield handle
    except BaseException as error:
        span.set_status(Status(StatusCode.ERROR, str(error)))
        record_error(span, error, ErrorCategory.TOOL)
        raise
    else:
        span.set_status(Status(StatusCode.OK))
    finally:
        otel_context.detach(token)
        span.end()


def _capture_span_content(
    span: Span,
    content_kind: str,
    reference_attribute: str,
    content: object,
) -> str | None:
    content_id = capture_content(content_kind, content)
    if content_id is None:
        return None
    span.set_attribute(reference_attribute, content_id)
    span.set_attribute(Attr.AGENT_CONTENT_RECORDED, "full")
    return content_id


def _attach(span: Span) -> Token[Any]:
    return otel_context.attach(trace.set_span_in_context(span))


def _set_optional(
    target: dict[str, Any] | Span,
    key: str,
    value: Any | None,
) -> None:
    if value is None:
        return
    if isinstance(target, dict):
        target[key] = value
    else:
        target.set_attribute(key, value)


def _enum_value(value: ToolType | str | None) -> str | None:
    if value is None:
        return None
    return value.value if isinstance(value, ToolType) else value

