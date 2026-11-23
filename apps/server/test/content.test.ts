import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  ContentExpiredError,
  ContentTooLargeError,
  createContentService,
  type ContentRecord,
  type ContentRepository,
} from "../src/application/content.js";

describe("content service", () => {
  it("stores bytes and returns opaque metadata", async () => {
    const records = new Map<string, ContentRecord>();
    const blobs = new Map<string, Buffer>();
    const service = createContentService(
      {
        async put(key, _mediaType, body) {
          blobs.set(key, Buffer.from(body));
        },
        async get(key) {
          return Readable.from(blobs.get(key) ?? Buffer.alloc(0));
        },
        async delete(key) {
          blobs.delete(key);
        },
      },
      repository(records),
      { maxBytes: 1024, retentionDays: 30 },
    );
    const body = Buffer.from('{"prompt":"hello"}');

    const record = await service.upload({
      ownerApp: "test-app",
      contentKind: "llm_input",
      mediaType: "application/json",
      captureMode: "full",
      redactionRuleVersion: "v1",
      body,
    });

    expect(record.contentId).toBeTruthy();
    expect(record.sha256).toBe(
      createHash("sha256").update(body).digest("hex"),
    );
    expect(blobs.get(record.objectKey)).toEqual(body);
    expect((await service.get(record.contentId, "reviewer")).metadata).toEqual(
      record,
    );
  });

  it("rejects content above the configured limit", async () => {
    const service = createContentService(
      {
        put: async () => undefined,
        get: async () => Readable.from([]),
        delete: async () => undefined,
      },
      repository(new Map()),
      { maxBytes: 4, retentionDays: 30 },
    );

    await expect(
      service.upload({
        ownerApp: "test-app",
        contentKind: "llm_output",
        mediaType: "text/plain",
        captureMode: "full",
        redactionRuleVersion: "v1",
        body: Buffer.from("too large"),
      }),
    ).rejects.toBeInstanceOf(ContentTooLargeError);
  });

  it("clones an available object with an independent retention window", async () => {
    const records = new Map<string, ContentRecord>();
    const blobs = new Map<string, Buffer>();
    const service = createContentService(
      {
        async put(key, _mediaType, body) {
          blobs.set(key, Buffer.from(body));
        },
        async get(key) {
          return Readable.from(blobs.get(key) ?? Buffer.alloc(0));
        },
        async delete(key) {
          blobs.delete(key);
        },
      },
      repository(records),
      {
        maxBytes: 1024,
        retentionDays: 30,
        now: () => new Date("2026-11-22T00:00:00.000Z"),
      },
    );
    const source = await service.upload({
      ownerApp: "source-app",
      contentKind: "llm_input",
      mediaType: "text/plain",
      captureMode: "full",
      redactionRuleVersion: "v1",
      body: Buffer.from("snapshot me"),
    });

    const copy = await service.copy({
      contentId: source.contentId,
      actorSubject: "reviewer",
      ownerApp: "agent-ops-datasets",
      contentKind: "dataset_input",
      retentionDays: 180,
    });

    expect(copy.contentId).not.toBe(source.contentId);
    expect(copy.ownerApp).toBe("agent-ops-datasets");
    expect(copy.contentKind).toBe("dataset_input");
    expect(copy.expiresAt?.toISOString()).toBe(
      "2027-05-21T00:00:00.000Z",
    );
    expect(blobs.get(copy.objectKey)?.toString("utf8")).toBe("snapshot me");
  });

  it("records access and rejects content whose retention window elapsed", async () => {
    const recordAccess = vi.fn().mockResolvedValue(undefined);
    const service = createContentService(
      {
        put: async () => undefined,
        get: async () => Readable.from([]),
        delete: async () => undefined,
      },
      {
        ...repository(new Map()),
        async find() {
          return {
            contentId: "content-1",
            objectKey: "content/one.txt",
            ownerApp: "test-app",
            contentKind: "llm_input",
            mediaType: "text/plain",
            captureMode: "full",
            sizeBytes: 1,
            sha256: "hash",
            redactionRuleVersion: "v1",
            encryption: "managed",
            status: "available",
            expiresAt: new Date("2026-11-20T00:00:00.000Z"),
          };
        },
        recordAccess,
      },
      {
        maxBytes: 1024,
        retentionDays: 30,
        now: () => new Date("2026-11-21T00:00:00.000Z"),
      },
    );

    await expect(service.get("content-1", "reviewer")).rejects.toBeInstanceOf(
      ContentExpiredError,
    );
    expect(recordAccess).toHaveBeenCalledWith({
      contentId: "content-1",
      actorSubject: "reviewer",
      decision: "expired",
      reason: "retention_expired",
    });
  });

  it("records a denied content read without consulting object storage", async () => {
    const get = vi.fn();
    const recordAccess = vi.fn().mockResolvedValue(undefined);
    const service = createContentService(
      {
        put: async () => undefined,
        get,
        delete: async () => undefined,
      },
      {
        ...repository(new Map()),
        recordAccess,
      },
      { maxBytes: 1024, retentionDays: 30 },
    );

    await service.auditDenied("content-1", "viewer");

    expect(get).not.toHaveBeenCalled();
    expect(recordAccess).toHaveBeenCalledWith({
      contentId: "content-1",
      actorSubject: "viewer",
      decision: "denied",
      reason: "missing_content_permission",
    });
  });
});

function repository(records: Map<string, ContentRecord>): ContentRepository {
  return {
    async insert(record) {
      records.set(record.contentId, record);
    },
    async find(contentId) {
      return records.get(contentId) ?? null;
    },
    async delete(contentId) {
      const record = records.get(contentId);
      records.delete(contentId);
      return record?.objectKey ?? null;
    },
    async recordAccess() {
      return undefined;
    },
  };
}

