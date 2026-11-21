import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { describe, expect, it } from "vitest";

import {
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
    expect((await service.get(record.contentId))?.metadata).toEqual(record);
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
});

function repository(records: Map<string, ContentRecord>): ContentRepository {
  return {
    async insert(record) {
      records.set(record.contentId, record);
    },
    async find(contentId) {
      return records.get(contentId) ?? null;
    },
  };
}

