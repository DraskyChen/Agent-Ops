from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from .generated import Attr, ContentRecorded, ErrorCategory

REDACTION_RULE_VERSION = "agent-ops-redaction-v1"
SUMMARY_MAX_CHARS = 256

_EMAIL = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
_PHONE = re.compile(r"\b1[3-9]\d{9}\b")
_IDENTITY = re.compile(r"\b\d{17}[\dXx]\b")
_BEARER = re.compile(
    r"\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}\b",
    re.IGNORECASE,
)
_API_KEY = re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b")


def redact(value: str) -> str:
    return _API_KEY.sub(
        "[REDACTED_API_KEY]",
        _BEARER.sub(
            r"\1[REDACTED_TOKEN]",
            _IDENTITY.sub(
                "[REDACTED_ID]",
                _PHONE.sub(
                    "[REDACTED_PHONE]",
                    _EMAIL.sub("[REDACTED_EMAIL]", value),
                ),
            ),
        ),
    )


def summarize(value: str | None) -> str | None:
    if value is None:
        return None
    return redact(value)[:SUMMARY_MAX_CHARS]


def common_attributes(
    span_type: str,
    *,
    content_recorded: ContentRecorded | str = ContentRecorded.METADATA_ONLY,
    input_summary: str | None = None,
    output_summary: str | None = None,
    input_ref: str | None = None,
    output_ref: str | None = None,
) -> dict[str, Any]:
    mode = (
        content_recorded
        if isinstance(content_recorded, ContentRecorded)
        else ContentRecorded(content_recorded)
    )
    attributes: dict[str, Any] = {
        Attr.AGENT_SPAN_TYPE: span_type,
        Attr.AGENT_CONTENT_RECORDED: mode.value,
        Attr.AGENT_REDACTION_APPLIED: REDACTION_RULE_VERSION,
    }
    _set_optional(attributes, Attr.AGENT_INPUT_SUMMARY, summarize(input_summary))
    _set_optional(attributes, Attr.AGENT_OUTPUT_SUMMARY, summarize(output_summary))
    _set_optional(attributes, Attr.AGENT_INPUT_REF, input_ref)
    _set_optional(attributes, Attr.AGENT_OUTPUT_REF, output_ref)
    return attributes


def record_error(
    span: Any,
    error: BaseException,
    category: ErrorCategory | str = ErrorCategory.OTHER,
) -> None:
    normalized_category = (
        category if isinstance(category, ErrorCategory) else ErrorCategory(category)
    )
    span.record_exception(error)
    span.set_attribute(Attr.ERROR_TYPE, type(error).__name__)
    span.set_attribute(Attr.AGENT_ERROR_CATEGORY, normalized_category.value)
    span.set_attribute("agent.error.message", redact(str(error))[:1024])


def merge_optional(
    attributes: Mapping[str, Any],
    key: str,
    value: Any | None,
) -> dict[str, Any]:
    merged = dict(attributes)
    _set_optional(merged, key, value)
    return merged


def _set_optional(attributes: dict[str, Any], key: str, value: Any | None) -> None:
    if value is not None:
        attributes[key] = value

