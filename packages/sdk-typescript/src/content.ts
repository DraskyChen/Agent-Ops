import { redact, REDACTION_RULE_VERSION } from "./attributes.js";
import type { ContentRecorded } from "./generated.js";

interface ContentUploadRequest {
  ownerApp: string;
  contentKind: string;
  mediaType: string;
  captureMode: ContentRecorded;
  redactionRuleVersion: string;
  content: string;
}

interface ContentUploadResponse {
  contentId?: string;
}

export interface ContentCaptureConfig {
  enabled: boolean;
  endpoint: string;
  ownerApp: string;
  token?: string;
  timeoutMs?: number;
  maxBytes?: number;
}

let activeConfig: Required<ContentCaptureConfig> | undefined;

export function configureContentCapture(config: ContentCaptureConfig): void {
  activeConfig = {
    enabled: config.enabled,
    endpoint: config.endpoint,
    ownerApp: config.ownerApp,
    token: config.token ?? "",
    timeoutMs: config.timeoutMs ?? 1_000,
    maxBytes: config.maxBytes ?? 2 * 1024 * 1024,
  };
}

export async function captureContent(
  contentKind: string,
  value: unknown,
): Promise<string | undefined> {
  const config = activeConfig;
  if (
    config === undefined ||
    !config.enabled ||
    value === undefined ||
    value === null
  ) {
    return undefined;
  }

  const serialized = serializeContent(value);
  const content = redact(serialized.content);
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes === 0 || bytes > config.maxBytes) {
    return undefined;
  }

  const payload: ContentUploadRequest = {
    ownerApp: config.ownerApp,
    contentKind,
    mediaType: serialized.mediaType,
    captureMode: "full" satisfies ContentRecorded,
    redactionRuleVersion: REDACTION_RULE_VERSION,
    content,
  };

  try {
    const response = await fetch(config.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(config.token === ""
          ? {}
          : { authorization: `Bearer ${config.token}` }),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as ContentUploadResponse;
    return body.contentId || undefined;
  } catch {
    return undefined;
  }
}

function serializeContent(value: unknown): {
  content: string;
  mediaType: string;
} {
  if (typeof value === "string") {
    return { content: value, mediaType: "text/plain; charset=utf-8" };
  }
  return {
    content: JSON.stringify(value, null, 2),
    mediaType: "application/json",
  };
}

