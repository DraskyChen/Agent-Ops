import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { ServerDependencies } from "../src/application/dependencies.js";
import { createOtlpIngestService } from "../src/application/ingest.js";
import { createTraceQueryService } from "../src/application/traces.js";
import { createDevHumanAuth } from "../src/infrastructure/auth/dev-auth.js";
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
    const list = vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
    });
    const app = buildApp({
      dependencies: testDependencies({
        traces: createTraceQueryService(
          {
            list,
            get: async () => null,
          },
          { now: () => new Date("2026-11-21T12:00:00.000Z") },
        ),
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/traces?status=failed&limit=25",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
    expect(list).toHaveBeenCalledWith({
      status: "failed",
      startedAfter: "2026-11-20T12:00:00.000Z",
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

  it("requires the application credential for feedback writes", async () => {
    const create = vi.fn();
    const app = buildApp({
      dependencies: testDependencies({
        authorizeIngest: () => false,
        feedback: { create },
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/feedback",
      payload: {
        traceId: "trace-1",
        eventId: "event-1",
        type: "thumbs_down",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(create).not.toHaveBeenCalled();
    await app.close();
  });

  it("prevents metadata-only viewers from writing a review", async () => {
    const create = vi.fn();
    const app = buildApp({
      dependencies: testDependencies({
        humanAuth: createDevHumanAuth({
          subject: "viewer",
          displayName: "Viewer",
          email: null,
          role: "viewer",
        }),
        reviews: { create },
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/traces/trace-1/reviews",
      payload: {
        status: "resolved",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
    await app.close();
  });

  it("prevents metadata-only viewers from creating datasets", async () => {
    const create = vi.fn();
    const app = buildApp({
      dependencies: testDependencies({
        humanAuth: createDevHumanAuth({
          subject: "viewer",
          displayName: "Viewer",
          email: null,
          role: "viewer",
        }),
        datasets: {
          ...testDependencies().datasets,
          create,
        },
      }),
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/datasets",
      payload: { name: "Regression cases" },
    });

    expect(response.statusCode).toBe(403);
    expect(create).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects malformed content IDs before querying object metadata", async () => {
    const get = vi.fn();
    const app = buildApp({
      dependencies: testDependencies({
        content: {
          upload: async () => {
            throw new Error("not configured");
          },
          get,
          copy: async () => {
            throw new Error("not configured");
          },
          discard: async () => undefined,
          auditDenied: async () => undefined,
        },
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/content/not-a-uuid",
    });

    expect(response.statusCode).toBe(404);
    expect(get).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires a human session for trace metadata", async () => {
    const devAuth = createDevHumanAuth({
      subject: "tester",
      displayName: "Tester",
      email: null,
      role: "admin",
    });
    const app = buildApp({
      dependencies: testDependencies({
        humanAuth: {
          ...devAuth,
          authenticate: async () => null,
        },
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/traces",
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("audits metadata-only viewers before denying content", async () => {
    const get = vi.fn();
    const auditDenied = vi.fn().mockResolvedValue(undefined);
    const app = buildApp({
      dependencies: testDependencies({
        humanAuth: createDevHumanAuth({
          subject: "viewer",
          displayName: "Viewer",
          email: null,
          role: "viewer",
        }),
        content: {
          upload: async () => {
            throw new Error("not configured");
          },
          get,
          copy: async () => {
            throw new Error("not configured");
          },
          discard: async () => undefined,
          auditDenied,
        },
      }),
    });
    const contentId = "00000000-0000-4000-8000-000000000001";

    const response = await app.inject({
      method: "GET",
      url: `/api/v1/content/${contentId}`,
    });

    expect(response.statusCode).toBe(403);
    expect(auditDenied).toHaveBeenCalledWith(contentId, "viewer");
    expect(get).not.toHaveBeenCalled();
    await app.close();
  });
});

function testDependencies(
  overrides: Partial<ServerDependencies> = {},
): ServerDependencies {
  return {
    healthCheck: async () => undefined,
    humanAuth: createDevHumanAuth({
      subject: "test-reviewer",
      displayName: "Test Reviewer",
      email: "reviewer@example.com",
      role: "admin",
    }),
    traces: {
      list: async () => ({ items: [], nextCursor: null }),
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
      get: async () => {
        throw new Error("not configured");
      },
      copy: async () => {
        throw new Error("not configured");
      },
      discard: async () => undefined,
      auditDenied: async () => undefined,
    },
    datasets: {
      list: async () => [],
      get: async () => null,
      getRevision: async () => null,
      create: async () => {
        throw new Error("not configured");
      },
      createRevision: async () => {
        throw new Error("not configured");
      },
    },
    evaluations: {
      list: async () => [],
      get: async () => null,
      create: async () => {
        throw new Error("not configured");
      },
      cancel: async () => null,
    },
    feedback: {
      create: async () => {
        throw new Error("not configured");
      },
    },
    metrics: {
      overview: async () => {
        throw new Error("not configured");
      },
      breakdown: async () => {
        throw new Error("not configured");
      },
    },
    reviews: {
      create: async () => {
        throw new Error("not configured");
      },
    },
    operations: {
      ingestHealth: async () => {
        throw new Error("not configured");
      },
    },
    authorizeIngest: () => true,
    ...overrides,
  };
}

