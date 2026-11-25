from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from threading import Lock
from urllib.parse import urlparse, urlunparse

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    SimpleSpanProcessor,
    SpanExporter,
)

from ._version import __version__ as _SDK_VERSION
from .content import (
    ContentCaptureConfig,
    clear_content_capture,
    configure_content_capture,
)
from .generated import SCHEMA_VERSION, SDK_NAME, Environment

_lock = Lock()
_provider: TracerProvider | None = None


@dataclass(frozen=True, slots=True)
class TracingConfig:
    service_name: str
    service_version: str
    app_name: str
    environment: Environment
    endpoint: str
    headers: Mapping[str, str] | None = None
    team: str | None = None
    span_exporter: SpanExporter | None = None
    simple_exporter: bool = False
    content_capture: bool = False
    content_endpoint: str | None = None
    content_token: str | None = None
    content_timeout_seconds: float = 1.0
    content_max_bytes: int = 2 * 1024 * 1024


def configure_tracing(config: TracingConfig) -> None:
    global _provider

    with _lock:
        if _provider is not None:
            raise RuntimeError("Agent Ops tracing has already been configured")

        attributes = {
            "service.name": config.service_name,
            "service.version": config.service_version,
            "deployment.environment.name": config.environment.value,
            "agent.app.name": config.app_name,
            "agent.sdk.name": SDK_NAME,
            "agent.sdk.version": _SDK_VERSION,
            "agent.schema.version": SCHEMA_VERSION,
        }
        if config.team is not None:
            attributes["agent.team"] = config.team

        exporter = config.span_exporter or OTLPSpanExporter(
            endpoint=config.endpoint,
            headers=dict(config.headers or {}),
        )
        provider = TracerProvider(resource=Resource.create(attributes))
        processor = (
            SimpleSpanProcessor(exporter)
            if config.simple_exporter
            else BatchSpanProcessor(exporter)
        )
        provider.add_span_processor(processor)
        trace.set_tracer_provider(provider)
        _provider = provider
        configure_content_capture(
            ContentCaptureConfig(
                enabled=config.content_capture,
                endpoint=config.content_endpoint
                or _content_endpoint(config.endpoint),
                owner_app=config.app_name,
                token=config.content_token,
                timeout_seconds=config.content_timeout_seconds,
                max_bytes=config.content_max_bytes,
            )
        )


def get_tracer() -> trace.Tracer:
    return trace.get_tracer(SDK_NAME, _SDK_VERSION)


def shutdown_tracing() -> None:
    global _provider

    with _lock:
        if _provider is None:
            return
        _provider.shutdown()
        _provider = None
        clear_content_capture()


def _content_endpoint(trace_endpoint: str) -> str:
    parsed = urlparse(trace_endpoint)
    return urlunparse(
        (
            parsed.scheme,
            parsed.netloc,
            "/api/v1/content",
            "",
            "",
            "",
        )
    )

