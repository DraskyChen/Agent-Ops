from __future__ import annotations

import os
import time

from agent_ops import Environment, TracingConfig, configure_tracing


def configure_examples() -> None:
    configure_tracing(
        TracingConfig(
            service_name="agent-ops-python-examples",
            service_version="0.1.0",
            app_name="agent-platform-python-examples",
            environment=Environment.STAGING,
            endpoint=os.getenv(
                "OTEL_EXPORTER_OTLP_ENDPOINT",
                "http://127.0.0.1:4318/v1/traces",
            ),
            content_capture=True,
            content_token=os.getenv("AGENT_OPS_INGEST_TOKEN"),
        )
    )


def sleep(milliseconds: int) -> None:
    time.sleep(milliseconds / 1000)

