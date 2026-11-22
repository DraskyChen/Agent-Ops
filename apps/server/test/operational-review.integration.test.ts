import { randomUUID } from "node:crypto";

import { metricBucketStart } from "@agent-ops/metrics";
import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";

import { buildApp } from "../src/app.js";
import { createServerDependencies } from "../src/composition.js";
import { createPool } from "../src/db/pool.js";
import { createPostgresMetricsRollupStore } from "../../worker/src/infrastructure/postgres/metrics-rollup-store.js";

const enabled = process.env.AGENT_OPS_INTEGRATION === "1";

describe.skipIf(!enabled)("operational review integration", () => {
  const traceId = `trace-integration-${randomUUID()}`;
  const contentId = randomUUID();
  let metricBucket: Date;
  let app: FastifyInstance;
  let pool: Pool;

  beforeAll(async () => {
    pool = createPool({
      connectionString:
        process.env.DATABASE_URL ??
        "postgres://agent_ops:agent_ops_dev@127.0.0.1:5433/agent_ops",
    });
    const now = new Date();
    metricBucket = metricBucketStart(now, "hour");
    await pool.query(
      `insert into traces (
        trace_id, app_name, run_name, service_name, service_version,
        environment, task_type, prompt_version, model, run_status,
        first_span_at, last_span_at, start_time, end_time, duration_ms,
        step_count, tool_error_count, input_tokens, output_tokens,
        cost_micros, currency, completeness, ingest_state, sealed_at
      ) values (
        $1, 'integration-app', 'integration run', 'worker', '1.2.3',
        'test', 'refund', 'prompt-v2', 'deepseek-flash', 'failed',
        $2, $2, $2, $2, 250, 2, 1, 120, 40, 900, 'USD',
        'complete', 'sealed_complete', now()
      )`,
      [traceId, now],
    );
    await pool.query(
      `insert into content_objects (
        content_id, object_key, owner_app, content_kind, media_type,
        capture_mode, size_bytes, sha256, redaction_rule_version,
        encryption, status, expires_at
      ) values (
        $1, $2, 'integration-app', 'llm_input', 'text/plain',
        'full', 4, 'hash', 'v1', 'managed', 'available', $3
      )`,
      [contentId, `integration/${contentId}.txt`, new Date(Date.now() - 1000)],
    );
    await createPostgresMetricsRollupStore(pool).rebuildBucket(metricBucket);

    const dependencies = await createServerDependencies({
      pool,
      ingestToken: "integration-secret",
      traceMaxLatenessHours: 24,
      auth: {
        mode: "dev",
        sessionTtlHours: 8,
        dev: {
          subject: "integration-reviewer",
          displayName: "Integration Reviewer",
          email: null,
          role: "admin",
        },
      },
      content: {
        endpoint: "http://127.0.0.1:9000",
        region: "us-east-1",
        bucket: "agent-ops-content",
        accessKey: "agent_ops",
        secretKey: "agent_ops_dev_secret",
        maxBytes: 2 * 1024 * 1024,
        retentionDays: 30,
      },
    });
    app = buildApp({ dependencies });
  });

  afterAll(async () => {
    await app?.close();
    if (pool !== undefined) {
      await pool.query("delete from feedback where trace_id = $1", [traceId]);
      await pool.query("delete from traces where trace_id = $1", [traceId]);
      await pool.query("delete from content_access_log where content_id = $1", [
        contentId,
      ]);
      await pool.query("delete from content_objects where content_id = $1", [
        contentId,
      ]);
      await pool.query(
        `delete from trace_metrics_hourly
         where bucket_start = $1 and app_name = 'integration-app'`,
        [metricBucket],
      );
      await pool.query(
        "delete from trace_metric_rollup_jobs where bucket_start = $1",
        [metricBucket],
      );
      await pool.end();
    }
  });

  it("supports the operational review path against PostgreSQL", async () => {
    const list = await app.inject({
      method: "GET",
      url: `/api/v1/traces?search=${traceId}&status=failed&hasErrors=true&taskType=refund`,
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      items: [
        {
          traceId,
          appName: "integration-app",
          promptVersion: "prompt-v2",
          reviewStatus: "unreviewed",
        },
      ],
    });

    const feedback = await app.inject({
      method: "POST",
      url: "/api/v1/feedback",
      headers: { authorization: "Bearer integration-secret" },
      payload: {
        traceId,
        eventId: "event-integration-1",
        type: "thumbs_down",
        comment: "refund was not completed",
      },
    });
    expect(feedback.statusCode).toBe(201);

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/feedback",
      headers: { authorization: "Bearer integration-secret" },
      payload: {
        traceId,
        eventId: "event-integration-1",
        type: "thumbs_down",
        comment: "refund was not completed",
      },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toMatchObject({ created: false });

    const review = await app.inject({
      method: "POST",
      url: `/api/v1/traces/${traceId}/reviews`,
      payload: {
        status: "resolved",
        issueArea: "tool",
        comment: "Tool timeout policy updated",
      },
    });
    expect(review.statusCode).toBe(201);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/traces/${traceId}`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      reviewStatus: "resolved",
      feedback: [{ type: "thumbs_down" }],
      reviews: [{ status: "resolved", issueArea: "tool" }],
    });

    const operations = await app.inject({
      method: "GET",
      url: "/api/v1/operations/ingest?windowHours=24",
    });
    expect(operations.statusCode).toBe(200);
    expect(operations.json()).toMatchObject({
      windowHours: 24,
      aggregation: { failed: expect.any(Number) },
    });

    const metrics = await app.inject({
      method: "GET",
      url: `/api/v1/metrics/overview?appName=integration-app&startedAfter=${encodeURIComponent(
        metricBucket.toISOString(),
      )}&startedBefore=${encodeURIComponent(
        new Date(metricBucket.getTime() + 60 * 60 * 1000).toISOString(),
      )}`,
    });
    expect(metrics.statusCode).toBe(200);
    expect(metrics.json()).toMatchObject({
      summary: {
        traceCount: 1,
        statusCounts: { failed: 1 },
      },
    });

    const breakdown = await app.inject({
      method: "GET",
      url: `/api/v1/metrics/breakdown?appName=integration-app&dimension=model&startedAfter=${encodeURIComponent(
        metricBucket.toISOString(),
      )}&startedBefore=${encodeURIComponent(
        new Date(metricBucket.getTime() + 60 * 60 * 1000).toISOString(),
      )}`,
    });
    expect(breakdown.statusCode).toBe(200);
    expect(breakdown.json()).toMatchObject({
      items: [{ value: "deepseek-flash", traceCount: 1 }],
    });

    const expired = await app.inject({
      method: "GET",
      url: `/api/v1/content/${contentId}`,
    });
    expect(expired.statusCode).toBe(410);
    const audit = await pool.query(
      `select decision from content_access_log
       where content_id = $1
       order by created_at desc
       limit 1`,
      [contentId],
    );
    expect(audit.rows[0]).toEqual({ decision: "expired" });
  });
});
