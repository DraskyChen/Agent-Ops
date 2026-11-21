import { createHash, randomUUID } from "node:crypto";
import type { Readable } from "node:stream";

import type {
  ContentRecorded,
  ContentStatus,
} from "@agent-ops/contracts";

export interface ContentUploadInput {
  ownerApp: string;
  contentKind: string;
  mediaType: string;
  captureMode: ContentRecorded;
  redactionRuleVersion: string;
  body: Uint8Array;
}

export interface ContentRecord {
  contentId: string;
  objectKey: string;
  ownerApp: string;
  contentKind: string;
  mediaType: string;
  captureMode: ContentRecorded;
  sizeBytes: number;
  sha256: string;
  redactionRuleVersion: string;
  encryption: string;
  status: ContentStatus;
  expiresAt: Date | null;
}

export interface StoredContent {
  metadata: ContentRecord;
  body: Readable;
}

export interface ContentBlobStore {
  put(objectKey: string, mediaType: string, body: Uint8Array): Promise<void>;
  get(objectKey: string): Promise<Readable>;
  delete(objectKey: string): Promise<void>;
}

export interface ContentRepository {
  insert(record: ContentRecord): Promise<void>;
  find(contentId: string): Promise<ContentRecord | null>;
  recordAccess(event: ContentAccessEvent): Promise<void>;
}

export interface ContentService {
  upload(input: ContentUploadInput): Promise<ContentRecord>;
  get(contentId: string, actorSubject: string | null): Promise<StoredContent>;
  auditDenied(contentId: string, actorSubject: string | null): Promise<void>;
}

export interface ContentServiceOptions {
  maxBytes: number;
  retentionDays: number;
  now?: () => Date;
}

export type ContentAccessDecision =
  | "allowed"
  | "denied"
  | "not_found"
  | "expired"
  | "error";

export interface ContentAccessEvent {
  contentId: string;
  actorSubject: string | null;
  decision: ContentAccessDecision;
  reason: string | null;
}

export class ContentTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`Content exceeds the ${maxBytes} byte limit`);
    this.name = "ContentTooLargeError";
  }
}

export class InvalidContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidContentError";
  }
}

export class ContentNotFoundError extends Error {
  constructor() {
    super("Content not found");
    this.name = "ContentNotFoundError";
  }
}

export class ContentExpiredError extends Error {
  constructor() {
    super("Content has expired");
    this.name = "ContentExpiredError";
  }
}

export class ContentStorageError extends Error {
  constructor(message: string, cause: unknown) {
    super(message, { cause });
    this.name = "ContentStorageError";
  }
}

export function createContentService(
  blobs: ContentBlobStore,
  repository: ContentRepository,
  options: ContentServiceOptions,
): ContentService {
  const now = options.now ?? (() => new Date());
  return {
    async upload(input) {
      validateUpload(input, options.maxBytes);
      const contentId = randomUUID();
      const uploadedAt = now();
      const extension = contentFileExtension(input.mediaType);
      const objectKey = [
        "content",
        String(uploadedAt.getUTCFullYear()),
        String(uploadedAt.getUTCMonth() + 1).padStart(2, "0"),
        String(uploadedAt.getUTCDate()).padStart(2, "0"),
        `${contentId}.${extension}`,
      ].join("/");
      const record: ContentRecord = {
        contentId,
        objectKey,
        ownerApp: input.ownerApp,
        contentKind: input.contentKind,
        mediaType: input.mediaType,
        captureMode: input.captureMode,
        sizeBytes: input.body.byteLength,
        sha256: createHash("sha256").update(input.body).digest("hex"),
        redactionRuleVersion: input.redactionRuleVersion,
        encryption: "deployment-managed",
        status: "available",
        expiresAt: new Date(
          uploadedAt.getTime() + options.retentionDays * 24 * 60 * 60 * 1000,
        ),
      };

      await blobs.put(objectKey, input.mediaType, input.body);
      try {
        await repository.insert(record);
      } catch (error) {
        await blobs.delete(objectKey).catch(() => undefined);
        throw error;
      }
      return record;
    },

    async get(contentId, actorSubject) {
      const metadata = await repository.find(contentId);
      if (metadata === null) {
        await record(repository, contentId, actorSubject, "not_found", null);
        throw new ContentNotFoundError();
      }
      if (
        metadata.status === "expired" ||
        metadata.status === "deleted" ||
        (metadata.expiresAt !== null && metadata.expiresAt <= now())
      ) {
        await record(
          repository,
          contentId,
          actorSubject,
          "expired",
          "retention_expired",
        );
        throw new ContentExpiredError();
      }
      if (metadata.status !== "available") {
        await record(
          repository,
          contentId,
          actorSubject,
          "not_found",
          `content_${metadata.status}`,
        );
        throw new ContentNotFoundError();
      }

      try {
        const body = await blobs.get(metadata.objectKey);
        await record(repository, contentId, actorSubject, "allowed", null);
        return { metadata, body };
      } catch (error) {
        await record(
          repository,
          contentId,
          actorSubject,
          "error",
          "object_storage_unavailable",
        );
        throw new ContentStorageError(
          "Content storage is temporarily unavailable",
          error,
        );
      }
    },

    async auditDenied(contentId, actorSubject) {
      await record(
        repository,
        contentId,
        actorSubject,
        "denied",
        "missing_content_permission",
      );
    },
  };
}

async function record(
  repository: ContentRepository,
  contentId: string,
  actorSubject: string | null,
  decision: ContentAccessDecision,
  reason: string | null,
): Promise<void> {
  await repository
    .recordAccess({ contentId, actorSubject, decision, reason })
    .catch(() => undefined);
}

export function contentFileExtension(mediaType: string): string {
  const normalized = mediaType.toLowerCase();
  if (normalized.includes("json")) {
    return "json";
  }
  if (normalized.startsWith("text/markdown")) {
    return "md";
  }
  if (normalized.startsWith("text/csv")) {
    return "csv";
  }
  if (normalized.startsWith("text/html")) {
    return "html";
  }
  if (normalized.startsWith("text/plain")) {
    return "txt";
  }
  if (normalized === "application/pdf") {
    return "pdf";
  }
  if (normalized === "image/png") {
    return "png";
  }
  if (normalized === "image/jpeg") {
    return "jpg";
  }
  if (normalized === "image/webp") {
    return "webp";
  }
  return "bin";
}

function validateUpload(input: ContentUploadInput, maxBytes: number): void {
  if (input.body.byteLength === 0) {
    throw new InvalidContentError("Content body is required");
  }
  if (input.body.byteLength > maxBytes) {
    throw new ContentTooLargeError(maxBytes);
  }
  if (input.captureMode !== "full") {
    throw new InvalidContentError(
      "Content uploads require captureMode=full",
    );
  }
  if (!/^[\w.-]{1,64}$/.test(input.contentKind)) {
    throw new InvalidContentError("Invalid contentKind");
  }
  if (!/^(text|application|image|audio|video)\//.test(input.mediaType)) {
    throw new InvalidContentError("Unsupported mediaType");
  }
  if (input.ownerApp.trim() === "") {
    throw new InvalidContentError("ownerApp is required");
  }
  if (input.redactionRuleVersion.trim() === "") {
    throw new InvalidContentError("redactionRuleVersion is required");
  }
}

