import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { ServerDependencies } from "../src/application/dependencies.js";
import { createOtlpIngestService } from "../src/application/ingest.js";
import { createTraceQueryService } from "../src/application/traces.js";
import { otlpCodec } from "../src/infrastructure/otlp/codec.js";

describe("Agent Ops server", () => {
  it("exposes service and contract health without starting a listening socket", async () => {
    const app = buildApp({
      dependencies: testDependencies(),
    });
    const response = await app.inject({
      method: "GET",
      url: "/healthz",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      schemaVersion: "0.1",
      database: "connected",
    });
    await app.close();
  });

  it("rejects an invalid OTLP body through the protobuf endpoint", async () => {
    const app = buildApp({
      dependencies: testDependencies({
        ingest: createOtlpIngestService(otlpCodec, {
          persist: async () => ({ acceptedCount: 0, rejectedCount: 0 }),
        }),
      }),
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/traces",
      payload: Buffer.from([0]),
      headers: {
        "content-type": "application/x-protobuf",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "OTLP_INGEST_FAILED",
    });
    await app.close();
  });

  it("delegates trace queries through the application service", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const app = buildApp({
      dependencies: testDependencies({
        traces: createTraceQueryService({
          list,
          get: async () => null,
        }),
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/traces?status=failed&limit=25",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [] });
    expect(list).toHaveBeenCalledWith({
      status: "failed",
      limit: 25,
    });
    await app.close();
  });

  it("rejects ingest before calling the ingest service when authorization fails", async () => {
    const receive = vi.fn();
    const app = buildApp({
      dependencies: testDependencies({
        authorizeIngest: () => false,
        ingest: { receive },
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/traces",
      payload: Buffer.from([]),
      headers: {
        "content-type": "application/x-protobuf",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(receive).not.toHaveBeenCalled();
    await app.close();
  });
});

function testDependencies(
  overrides: Partial<ServerDependencies> = {},
): ServerDependencies {
  return {
    healthCheck: async () => undefined,
    traces: {
      list: async () => [],
      get: async () => null,
    },
    ingest: {
      receive: async () => {
        throw new Error("not configured");
      },
    },
    content: {
      upload: async () => {
        throw new Error("not configured");
      },
      get: async () => null,
    },
    authorizeIngest: () => true,
    ...overrides,
  };
}

