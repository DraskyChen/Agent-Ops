from __future__ import annotations

import json
from dataclasses import dataclass

import requests

from .attributes import REDACTION_RULE_VERSION, redact


@dataclass(frozen=True, slots=True)
class ContentCaptureConfig:
    enabled: bool
    endpoint: str
    owner_app: str
    token: str | None = None
    timeout_seconds: float = 1.0
    max_bytes: int = 2 * 1024 * 1024


_active_config: ContentCaptureConfig | None = None


def configure_content_capture(config: ContentCaptureConfig) -> None:
    global _active_config
    _active_config = config


def clear_content_capture() -> None:
    global _active_config
    _active_config = None


def capture_content(
    content_kind: str,
    value: object | None,
) -> str | None:
    config = _active_config
    if not config or not config.enabled or value is None:
        return None

    if isinstance(value, str):
        media_type = "text/plain; charset=utf-8"
        content = value
    else:
        media_type = "application/json"
        content = json.dumps(value, ensure_ascii=False, default=str, indent=2)
    content = redact(content)
    if not content or len(content.encode("utf-8")) > config.max_bytes:
        return None

    headers = {"content-type": "application/json"}
    if config.token:
        headers["authorization"] = f"Bearer {config.token}"

    try:
        response = requests.post(
            config.endpoint,
            headers=headers,
            json={
                "ownerApp": config.owner_app,
                "contentKind": content_kind,
                "mediaType": media_type,
                "captureMode": "full",
                "redactionRuleVersion": REDACTION_RULE_VERSION,
                "content": content,
            },
            timeout=config.timeout_seconds,
        )
        response.raise_for_status()
        content_id = response.json().get("contentId")
        return content_id if isinstance(content_id, str) and content_id else None
    except (requests.RequestException, ValueError, TypeError):
        return None

