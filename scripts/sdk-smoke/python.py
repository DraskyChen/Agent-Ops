from __future__ import annotations

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult

from agent_ops import (
    Attr,
    Environment,
    TracingConfig,
    __version__,
    agent_run,
    configure_tracing,
    llm_call,
    shutdown_tracing,
    tool_call,
)


class CapturingExporter(SpanExporter):
    def __init__(self) -> None:
        self.spans: list[Any] = []

    def export(self, spans: list[Any]) -> SpanExportResult:
        self.spans.extend(spans)
        return SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        return None

    def force_flush(self, timeout_millis: int = 30_000) -> bool:
        return True


class ContentHandler(BaseHTTPRequestHandler):
    mode = "success"
    bodies: list[dict[str, Any]] = []

    def do_POST(self) -> None:
        length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(length))
        self.bodies.append(body)
        status = 201 if self.mode == "success" else 503
        payload = (
            {"contentId": "content-smoke"}
            if self.mode == "success"
            else {"code": "CONTENT_UNAVAILABLE"}
        )
        encoded = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: object) -> None:
        return None


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "success"
    if mode not in {"success", "failure"}:
        raise ValueError(f"Unknown mode {mode}")

    ContentHandler.mode = mode
    server = ThreadingHTTPServer(("127.0.0.1", 0), ContentHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    exporter = CapturingExporter()
    try:
        configure_tracing(
            TracingConfig(
                service_name="sdk-package-smoke",
                service_version="1.0.0",
                app_name="sdk-package-smoke",
                environment=Environment.TEST,
                endpoint="http://127.0.0.1:4318/v1/traces",
                span_exporter=exporter,
                simple_exporter=True,
                content_capture=True,
                content_endpoint=(
                    f"http://127.0.0.1:{server.server_port}/api/v1/content"
                ),
                content_timeout_seconds=0.2,
            )
        )

        with agent_run(
            session_id="sdk-package-smoke",
            task_type="support",
            input_summary="user=smoke@example.com",
        ) as run:
            run.capture_input_content({"email": "smoke@example.com"})
            with llm_call(
                provider="smoke",
                request_model="smoke-model",
                input_tokens=10,
                output_tokens=2,
            ):
                pass

            try:
                with tool_call(
                    name="smoke_tool",
                    args_summary='{"case":"failure"}',
                ):
                    raise RuntimeError("expected smoke failure")
            except RuntimeError:
                pass

            run.complete("success", "final_answer")
    finally:
        shutdown_tracing()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)

    assert ContentHandler.bodies, "content capture request was not sent"
    assert ContentHandler.bodies[0]["ownerApp"] == "sdk-package-smoke"
    assert "smoke@example.com" not in ContentHandler.bodies[0]["content"]
    assert "[REDACTED_EMAIL]" in ContentHandler.bodies[0]["content"]

    spans_by_name = {span.name: span for span in exporter.spans}
    root = spans_by_name["agent.run"]
    llm = spans_by_name["chat"]
    tool = spans_by_name["smoke_tool"]
    assert root.attributes[Attr.AGENT_RUN_STATUS] == "success"
    assert root.resource.attributes["agent.sdk.version"] == __version__
    assert llm.parent is not None
    assert tool.parent is not None
    assert llm.parent.span_id == root.context.span_id
    assert tool.parent.span_id == root.context.span_id
    assert llm.context.trace_id == root.context.trace_id
    assert tool.context.trace_id == root.context.trace_id
    assert tool.attributes[Attr.AGENT_ERROR_CATEGORY] == "tool"

    if mode == "success":
        assert root.attributes[Attr.AGENT_INPUT_REF] == "content-smoke"
        assert root.attributes[Attr.AGENT_CONTENT_RECORDED] == "full"
    else:
        assert Attr.AGENT_INPUT_REF not in root.attributes

    print(f"Python SDK {__version__} {mode} smoke passed.")


if __name__ == "__main__":
    main()
