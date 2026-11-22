import { randomUUID } from "node:crypto";

import { metricBucketStart } from "@agent-ops/metrics";
import type { DatasetRevisionDetail } from "@agent-ops/contracts";
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
import { createMinioContentStore } from "../src/infrastructure/minio/content-store.js";
import { createPostgresMetricsRollupStore } from "../../worker/src/infrastructure/postgres/metrics-rollup-store.js";

const enabled = process.env.AGENT_OPS_INTEGRATION === "1";

describe.skipIf(!enabled)("operational review integration", () => {
  const traceId = `trace-integration-${randomUUID()}`;
  const datasetTraceId = `trace-dataset-${randomUUID()}`;
  const contentId = randomUUID();
  const datasetContentIds: string[] = [];
  let datasetInputContentId: string | undefined;
  let datasetOutputContentId: string | undefined;
  let datasetId: string | undefined;
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
        datasetRetentionDays: 180,
      },
    });
    app = buildApp({ dependencies });

    for (const [contentKind, content] of [
      ["agent_input", "integration prompt"],
      ["agent_output", "integration answer"],
    ] as const) {
      const uploaded = await app.inject({
        method: "POST",
        url: "/api/v1/content",
        headers: { authorization: "Bearer integration-secret" },
        payload: {
          ownerApp: "integration-app",
          contentKind,
          mediaType: "text/plain",
          captureMode: "full",
          redactionRuleVersion: "v1",
          content,
        },
      });
      expect(uploaded.statusCode).toBe(201);
      datasetContentIds.push(
        (uploaded.json() as { contentId: string }).contentId,
      );
    }
    [datasetInputContentId, datasetOutputContentId] = datasetContentIds;
    await pool.query(
      `insert into traces (
        trace_id, root_span_id, app_name, run_name, service_name,
        service_version, environment, task_type, prompt_version, eval_case_id,
        model, run_status, first_span_at, last_span_at, start_time, end_time,
        duration_ms, step_count, tool_error_count, input_tokens, output_tokens,
        cost_micros, currency, completeness, ingest_state, sealed_at
      ) values (
        $1, 'dataset-root', 'integration-app', 'dataset baseline', 'worker',
        '1.2.3', 'test', 'refund', 'prompt-v1', 'refund-case-integration',
        'deepseek-flash', 'success', now(), now(), now(), now(), 100, 0, 0,
        10, 5, 100, 'USD', 'complete', 'sealed_complete', now()
      )`,
      [datasetTraceId],
    );
    await pool.query(
      `insert into spans (
        trace_id, span_id, service_name, service_version, environment,
        span_type, name, start_time, end_time, duration_ms, status,
        resource_attributes, attributes, input_content_ref,
        output_content_ref, content_recorded, schema_version
      ) values (
        $1, 'dataset-root', 'worker', '1.2.3', 'test', 'agent.run',
        'refund-agent', now(), now(), 100, 'OK', '{}'::jsonb, '{}'::jsonb,
        $2, $3, 'full', '0.1'
      )`,
      [datasetTraceId, datasetInputContentId, datasetOutputContentId],
    );
  });

  afterAll(async () => {
    await app?.close();
    if (pool !== undefined) {
      await pool.query("delete from feedback where trace_id = $1", [traceId]);
      await pool.query("delete from traces where trace_id = $1", [traceId]);
      if (datasetId !== undefined) {
        const copied = await pool.query<{ object_key: string }>(
          "select object_key from content_objects where owner_app = $1",
          ["agent-ops-datasets"],
        );
        await pool.query("delete from datasets where id = $1", [datasetId]);
        await pool.query(
          "delete from content_objects where owner_app = $1",
          ["agent-ops-datasets"],
        );
        const blobs = createMinioContentStore({
          endpoint: "http://127.0.0.1:9000",
          region: "us-east-1",
          bucket: "agent-ops-content",
          accessKey: "agent_ops",
          secretKey: "agent_ops_dev_secret",
        });
        for (const row of copied.rows) {
          await blobs.delete(row.object_key).catch(() => undefined);
        }
      }
      const sourceContent = await pool.query<{ object_key: string }>(
        "select object_key from content_objects where content_id = any($1::uuid[])",
        [datasetContentIds],
      );
      await pool.query("delete from traces where trace_id = $1", [
        datasetTraceId,
      ]);
      await pool.query("delete from content_access_log where content_id = $1", [
        contentId,
      ]);
      await pool.query("delete from content_objects where content_id = $1", [
        contentId,
      ]);
      await pool.query(
        "delete from content_objects where content_id = any($1::uuid[])",
        [datasetContentIds],
      );
      const blobs = createMinioContentStore({
        endpoint: "http://127.0.0.1:9000",
        region: "us-east-1",
        bucket: "agent-ops-content",
        accessKey: "agent_ops",
        secretKey: "agent_ops_dev_secret",
      });
      for (const row of sourceContent.rows) {
        await blobs.delete(row.object_key).catch(() => undefined);
      }
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

    const createdDataset = await app.inject({
      method: "POST",
      url: "/api/v1/datasets",
      payload: {
        name: `integration-dataset-${randomUUID()}`,
        description: "integration snapshot",
      },
    });
    expect(createdDataset.statusCode).toBe(201);
    datasetId = (createdDataset.json() as { datasetId: string }).datasetId;

    const revision = await app.inject({
      method: "POST",
      url: `/api/v1/datasets/${datasetId}/revisions`,
      payload: {
        note: "baseline",
        items: [
          {
            traceId: datasetTraceId,
            expectedOutput: "Refund completed",
            expectedBehavior: "Only promise a refund after tool success",
            tags: ["refund", "integration"],
          },
        ],
      },
    });
    expect(revision.statusCode).toBe(201);
    const revisionBody = revision.json() as DatasetRevisionDetail;
    expect(revisionBody).toMatchObject({
      revision: 1,
      itemCount: 1,
      items: [
        {
          caseId: "refund-case-integration",
          sourceTraceId: datasetTraceId,
          expectedBehavior: "Only promise a refund after tool success",
        },
      ],
    });
    const item = revisionBody.items[0];
    expect(item).toBeDefined();
    if (item !== undefined) {
      expect(item.inputContentRef).not.toBe(datasetInputContentId);
      expect(item.baselineOutputContentRef).not.toBe(
        datasetOutputContentId,
      );
      expect(item.expectedOutputContentRef).not.toBeNull();
      datasetContentIds.push(
        item.inputContentRef,
        item.baselineOutputContentRef,
        ...(item.expectedOutputContentRef === null
          ? []
          : [item.expectedOutputContentRef]),
      );
    }

    const dataset = await app.inject({
      method: "GET",
      url: `/api/v1/datasets/${datasetId}`,
    });
    expect(dataset.statusCode).toBe(200);
    expect(dataset.json()).toMatchObject({
      latestRevision: 1,
      itemCount: 1,
      revisions: [{ revision: 1, itemCount: 1 }],
    });
  });
});
