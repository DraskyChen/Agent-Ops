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
import { createEvaluationWorker } from "../../worker/src/application/evaluate-rule-run.js";
import { createPostgresEvaluationWorkerStore } from "../../worker/src/infrastructure/postgres/evaluation-worker-store.js";
import { createObjectTextReader } from "../../worker/src/infrastructure/minio/object-reader.js";
import { createObjectTextWriter } from "../../worker/src/infrastructure/minio/object-writer.js";
import { createMinioContentStore } from "../src/infrastructure/minio/content-store.js";
import { createPostgresMetricsRollupStore } from "../../worker/src/infrastructure/postgres/metrics-rollup-store.js";

const enabled = process.env.AGENT_OPS_INTEGRATION === "1";

describe.skipIf(!enabled)("operational review integration", () => {
  const traceId = `trace-integration-${randomUUID()}`;
  const datasetTraceId = `trace-dataset-${randomUUID()}`;
  const candidateTraceId = `trace-candidate-${randomUUID()}`;
  const contentId = randomUUID();
  const datasetContentIds: string[] = [];
  let datasetInputContentId: string | undefined;
  let datasetOutputContentId: string | undefined;
  let candidateOutputContentId: string | undefined;
  let datasetId: string | undefined;
  let evaluationId: string | undefined;
  let baselineEvaluationId: string | undefined;
  let judgeEvaluationId: string | undefined;
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
      evaluationJudgeEnabled: true,
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
      const cleanupObjectKeys: string[] = [];
      await pool.query(
        "delete from feedback where trace_id = any($1::text[])",
        [[traceId, candidateTraceId]],
      );
      await pool.query(
        "delete from prompt_registry where prompt_version like 'integration-prompt-%'",
      );
      await pool.query("delete from traces where trace_id = $1", [traceId]);
      const evaluationIds = [
        evaluationId,
        baselineEvaluationId,
        judgeEvaluationId,
      ].filter(
        (id): id is string => id !== undefined,
      );
      const datasetContent =
        datasetId === undefined
          ? { rows: [] }
          : await pool.query<{ content_id: string; object_key: string }>(
              `select distinct c.content_id::text, c.object_key
               from dataset_revisions r
               join dataset_items i on i.dataset_revision_id = r.id
               cross join lateral (
                 values (i.input_content_ref),
                   (i.baseline_output_content_ref),
                   (i.expected_output_content_ref)
               ) refs(content_id)
               join content_objects c on c.content_id::text = refs.content_id
               where r.dataset_id = $1`,
              [datasetId],
            );
      const judgeContent =
        evaluationIds.length === 0
          ? { rows: [] }
          : await pool.query<{ content_id: string; object_key: string }>(
              `select distinct c.content_id::text, c.object_key
               from judge_calls j
               cross join lateral (
                 values (j.prompt_content_ref), (j.response_content_ref)
               ) refs(content_id)
               join content_objects c on c.content_id::text = refs.content_id
               where j.evaluation_run_id = any($1::uuid[])`,
              [evaluationIds],
            );
      cleanupObjectKeys.push(
        ...datasetContent.rows.map((row) => row.object_key),
        ...judgeContent.rows.map((row) => row.object_key),
      );
      for (const id of evaluationIds) {
        await pool.query("delete from evaluation_runs where id = $1", [id]);
      }
      if (evaluationIds.length > 0) {
        await pool.query(
          "delete from evaluator_versions where name like '%integration-%'",
        );
      }
      if (datasetId !== undefined) {
        await pool.query("delete from datasets where id = $1", [datasetId]);
      }
      const createdContentIds = [
        ...datasetContent.rows.map((row) => row.content_id),
        ...judgeContent.rows.map((row) => row.content_id),
      ];
      if (createdContentIds.length > 0) {
        await pool.query(
          "delete from content_access_log where content_id = any($1::uuid[])",
          [createdContentIds],
        );
        await pool.query(
          "delete from content_objects where content_id = any($1::uuid[])",
          [createdContentIds],
        );
      }
      const sourceContent = await pool.query<{ object_key: string }>(
        "select object_key from content_objects where content_id = any($1::uuid[])",
        [datasetContentIds],
      );
      await pool.query("delete from traces where trace_id = $1", [
        datasetTraceId,
      ]);
      await pool.query("delete from traces where trace_id = $1", [
        candidateTraceId,
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
        cleanupObjectKeys.push(row.object_key);
      }
      for (const objectKey of cleanupObjectKeys) {
        await blobs.delete(objectKey).catch(() => undefined);
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

    const revisionDetail = await app.inject({
      method: "GET",
      url: `/api/v1/datasets/${datasetId}/revisions/${revisionBody.revisionId}`,
    });
    expect(revisionDetail.statusCode).toBe(200);
    expect(revisionDetail.json()).toMatchObject({
      revision: 1,
      items: [
        {
          caseId: "refund-case-integration",
          sourceTraceId: datasetTraceId,
        },
      ],
    });

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

    const derivedRevision = await app.inject({
      method: "POST",
      url: `/api/v1/datasets/${datasetId}/revisions`,
      payload: {
        baseRevisionId: revisionBody.revisionId,
        note: "Updated expected output",
        items: [
          {
            sourceRevisionItemId: item.itemId,
            expectedOutput: "Refund completed with updated guidance",
          },
        ],
      },
    });
    expect(derivedRevision.statusCode).toBe(201);
    const derivedRevisionBody = derivedRevision.json() as DatasetRevisionDetail;
    const revisionDiff = await app.inject({
      method: "GET",
      url: `/api/v1/datasets/${datasetId}/revisions/${revisionBody.revisionId}/diff/${derivedRevisionBody.revisionId}`,
    });
    expect(revisionDiff.statusCode).toBe(200);
    expect(revisionDiff.json()).toMatchObject({
      addedCount: 0,
      removedCount: 0,
      changedCount: 1,
      unchangedCount: 0,
      items: [
        {
          caseId: "refund-case-integration",
          status: "changed",
          changes: ["expected_output"],
        },
      ],
    });

    const candidateContent = await app.inject({
      method: "POST",
      url: "/api/v1/content",
      headers: { authorization: "Bearer integration-secret" },
      payload: {
        ownerApp: "integration-app",
        contentKind: "agent_output",
        mediaType: "text/plain",
        captureMode: "full",
        redactionRuleVersion: "v1",
        content: "Refund completed",
      },
    });
    expect(candidateContent.statusCode).toBe(201);
    candidateOutputContentId = (
      candidateContent.json() as { contentId: string }
    ).contentId;
    datasetContentIds.push(candidateOutputContentId);
    await pool.query(
      `insert into traces (
        trace_id, root_span_id, app_name, run_name, service_name,
        service_version, environment, task_type, prompt_version, eval_case_id,
        model, run_status, first_span_at, last_span_at, start_time, end_time,
        duration_ms, step_count, tool_error_count, input_tokens, output_tokens,
        cost_micros, currency, completeness, ingest_state, sealed_at
      ) values (
        $1, 'candidate-root', 'integration-app', 'dataset candidate', 'worker',
        '1.2.3', 'test', 'refund', 'prompt-v2', 'refund-case-integration',
        'deepseek-flash', 'success', now(), now(), now(), now(), 90, 0, 0,
        10, 5, 90, 'USD', 'complete', 'sealed_complete', now()
      )`,
      [candidateTraceId],
    );
    await pool.query(
      `insert into spans (
        trace_id, span_id, service_name, service_version, environment,
        span_type, name, start_time, end_time, duration_ms, status,
        resource_attributes, attributes, input_content_ref,
        output_content_ref, content_recorded, schema_version
      ) values (
        $1, 'candidate-root', 'worker', '1.2.3', 'test', 'agent.run',
        'refund-agent', now(), now(), 90, 'OK', '{}'::jsonb, '{}'::jsonb,
        null, $2, 'full', '0.1'
      )`,
      [candidateTraceId, candidateOutputContentId],
    );

    const exactEvaluatorName = `exact-integration-${randomUUID()}`;
    const evaluationResponse = await app.inject({
      method: "POST",
      url: "/api/v1/evaluations",
      payload: {
        datasetRevisionId: revisionBody.revisionId,
        evaluator: {
          name: exactEvaluatorName,
          version: 1,
          kind: "exact",
          config: {},
        },
        traceSelector: {
          appName: "integration-app",
          promptVersion: "prompt-v2",
          startedAfter: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          startedBefore: new Date(Date.now() + 60 * 1000).toISOString(),
        },
      },
    });
    expect(evaluationResponse.statusCode).toBe(201);
    evaluationId = (
      evaluationResponse.json() as { evaluationId: string }
    ).evaluationId;
    const baselineEvaluationResponse = await app.inject({
      method: "POST",
      url: "/api/v1/evaluations",
      payload: {
        datasetRevisionId: revisionBody.revisionId,
        evaluator: {
          name: exactEvaluatorName,
          version: 1,
          kind: "exact",
          config: {},
        },
        traceSelector: {
          appName: "integration-app",
          promptVersion: "prompt-v1",
          startedAfter: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          startedBefore: new Date(Date.now() + 60 * 1000).toISOString(),
        },
      },
    });
    expect(baselineEvaluationResponse.statusCode).toBe(201);
    baselineEvaluationId = (
      baselineEvaluationResponse.json() as { evaluationId: string }
    ).evaluationId;
    const listedEvaluations = await app.inject({
      method: "GET",
      url: "/api/v1/evaluations",
    });
    expect(listedEvaluations.statusCode).toBe(200);
    expect(listedEvaluations.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evaluationId,
          status: "queued",
          datasetRevisionId: revisionBody.revisionId,
        }),
      ]),
    );
    const templateName = `template-integration-${randomUUID()}`;
    const templateResponse = await app.inject({
      method: "POST",
      url: "/api/v1/evaluators",
      payload: {
        evaluator: {
          name: templateName,
          version: 1,
          kind: "contains",
          config: { value: "refund", ignoreCase: true },
        },
      },
    });
    expect(templateResponse.statusCode).toBe(201);
    expect(templateResponse.json()).toMatchObject({
      evaluator: {
        name: templateName,
        version: 1,
        kind: "contains",
        config: { value: "refund", ignoreCase: true },
      },
    });
    const listedTemplates = await app.inject({
      method: "GET",
      url: "/api/v1/evaluators",
    });
    expect(listedTemplates.statusCode).toBe(200);
    expect(listedTemplates.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evaluator: expect.objectContaining({ name: templateName }),
        }),
      ]),
    );
    const promptVersion = `integration-prompt-${randomUUID()}`;
    const registerPrompt = await app.inject({
      method: "POST",
      url: "/api/v1/prompts",
      payload: {
        promptVersion,
        name: "Integration prompt",
        owner: "Integration Reviewer",
        description: "Prompt registry integration test",
      },
    });
    expect(registerPrompt.statusCode).toBe(201);
    expect(registerPrompt.json()).toMatchObject({
      promptVersion,
      name: "Integration prompt",
      owner: "Integration Reviewer",
      status: "active",
    });
    const promptRegistry = await app.inject({
      method: "GET",
      url: "/api/v1/prompts",
    });
    expect(promptRegistry.statusCode).toBe(200);
    expect(promptRegistry.json()).toMatchObject({
      entries: expect.arrayContaining([
        expect.objectContaining({ promptVersion }),
      ]),
    });
    const updatePrompt = await app.inject({
      method: "PATCH",
      url: `/api/v1/prompts/${promptVersion}`,
      payload: {
        owner: null,
        description: "Deprecated during integration test",
        status: "deprecated",
      },
    });
    expect(updatePrompt.statusCode).toBe(200);
    expect(updatePrompt.json()).toMatchObject({
      prompt: {
        promptVersion,
        owner: null,
        description: "Deprecated during integration test",
        status: "deprecated",
      },
      history: [
        expect.objectContaining({
          eventType: "updated",
          actor: "Integration Reviewer",
        }),
        expect.objectContaining({ eventType: "created" }),
      ],
    });
    await pool.query(
      `insert into feedback (trace_id, event_id, type, comment)
       values ($1, $2, 'thumbs_down', 'integration candidate')`,
      [candidateTraceId, `candidate-${randomUUID()}`],
    );
    const candidates = await app.inject({
      method: "GET",
      url: "/api/v1/candidates",
    });
    expect(candidates.statusCode).toBe(200);
    const candidateBody = candidates.json() as {
      counts: { active: number; negativeFeedback: number };
      items: Array<{
        traceId: string;
        reasons: string[];
        datasetCount: number;
        datasetEligible: boolean;
        dismissedAt: string | null;
      }>;
    };
    expect(candidateBody.counts.active).toBeGreaterThanOrEqual(1);
    expect(candidateBody.counts.negativeFeedback).toBeGreaterThanOrEqual(1);
    expect(
      candidateBody.items.find((item) => item.traceId === candidateTraceId),
    ).toMatchObject({
      reasons: expect.arrayContaining(["negative_feedback"]),
      datasetCount: 0,
      datasetEligible: false,
      dismissedAt: null,
    });
    const dismissed = await app.inject({
      method: "POST",
      url: `/api/v1/candidates/${candidateTraceId}/dismiss`,
      payload: { reason: "integration review" },
    });
    expect(dismissed.statusCode).toBe(200);
    expect(dismissed.json()).toEqual({
      traceId: candidateTraceId,
      dismissed: true,
    });
    const restored = await app.inject({
      method: "POST",
      url: `/api/v1/candidates/${candidateTraceId}/restore`,
      payload: {},
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toEqual({
      traceId: candidateTraceId,
      dismissed: false,
    });
    const evaluationWorker = createEvaluationWorker(
      createPostgresEvaluationWorkerStore(
        pool,
        createObjectTextReader({
          endpoint: "http://127.0.0.1:9000",
          region: "us-east-1",
          bucket: "agent-ops-content",
          accessKey: "agent_ops",
          secretKey: "agent_ops_dev_secret",
        }),
        createObjectTextWriter({
          endpoint: "http://127.0.0.1:9000",
          region: "us-east-1",
          bucket: "agent-ops-content",
          accessKey: "agent_ops",
          secretKey: "agent_ops_dev_secret",
        }),
      ),
    );
    await expect(evaluationWorker.processNextRun()).resolves.toBe(true);
    await expect(evaluationWorker.processNextRun()).resolves.toBe(true);

    const evaluated = await app.inject({
      method: "GET",
      url: `/api/v1/evaluations/${evaluationId}`,
    });
    expect(evaluated.statusCode).toBe(200);
    expect(evaluated.json()).toMatchObject({
      status: "completed",
      totalCases: 1,
      scoredCases: 1,
      passedCases: 1,
      failedCases: 0,
      averageScore: 1,
      evaluator: {
        name: exactEvaluatorName,
        version: 1,
        kind: "exact",
        config: {},
      },
      cases: [
        {
          caseId: "refund-case-integration",
          candidateTraceId,
          status: "completed",
          score: 1,
          passed: true,
        },
      ],
    });
    const score = await pool.query(
      `select source, value
       from scores
       where evaluation_run_id = $1`,
      [evaluationId],
    );
    expect(score.rows).toHaveLength(1);
    expect(score.rows[0]).toMatchObject({
      source: "rule",
      value: { score: 1, pass: true },
    });

    const comparison = await app.inject({
      method: "GET",
      url: `/api/v1/evaluations/${baselineEvaluationId}/compare/${evaluationId}`,
    });
    expect(comparison.statusCode).toBe(200);
    expect(comparison.json()).toMatchObject({
      pairedCases: 1,
      baselineOnlyCases: 0,
      candidateOnlyCases: 0,
      baseline: {
        candidatePromptVersion: "prompt-v1",
        passedCases: 0,
        averageScore: 0,
      },
      candidate: {
        candidatePromptVersion: "prompt-v2",
        passedCases: 1,
        averageScore: 1,
      },
      cases: [
        {
          caseId: "refund-case-integration",
          scoreDelta: 1,
        },
      ],
    });

    const judgeEvaluation = await app.inject({
      method: "POST",
      url: "/api/v1/evaluations",
      payload: {
        datasetRevisionId: revisionBody.revisionId,
        evaluator: {
          name: `judge-integration-${randomUUID()}`,
          version: 1,
          kind: "llm_judge",
          config: {
            model: "deepseek-flash",
            rubric:
              "Pass only when the candidate is complete, correct, and grounded in the input.",
            allowExternalContent: true,
            temperature: 0,
          },
        },
        traceSelector: {
          appName: "integration-app",
          promptVersion: "prompt-v2",
          startedAfter: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          startedBefore: new Date(Date.now() + 60 * 1000).toISOString(),
        },
      },
    });
    expect(judgeEvaluation.statusCode).toBe(201);
    judgeEvaluationId = (
      judgeEvaluation.json() as { evaluationId: string }
    ).evaluationId;
    const judgeWorker = createEvaluationWorker(
      createPostgresEvaluationWorkerStore(
        pool,
        createObjectTextReader({
          endpoint: "http://127.0.0.1:9000",
          region: "us-east-1",
          bucket: "agent-ops-content",
          accessKey: "agent_ops",
          secretKey: "agent_ops_dev_secret",
        }),
        createObjectTextWriter({
          endpoint: "http://127.0.0.1:9000",
          region: "us-east-1",
          bucket: "agent-ops-content",
          accessKey: "agent_ops",
          secretKey: "agent_ops_dev_secret",
        }),
      ),
      {
        judgeClient: {
          evaluate: async () => ({
            content:
              '{"score":0.9,"pass":true,"reason":"Complete and grounded","category":"correct"}',
            inputTokens: 40,
            outputTokens: 12,
          }),
        },
      },
    );
    await expect(judgeWorker.processNextRun()).resolves.toBe(true);

    const judged = await app.inject({
      method: "GET",
      url: `/api/v1/evaluations/${judgeEvaluationId}`,
    });
    expect(judged.statusCode).toBe(200);
    expect(judged.json()).toMatchObject({
      status: "completed",
      evaluatorKind: "llm_judge",
      scoredCases: 1,
      passedCases: 1,
      averageScore: 0.9,
      cases: [
        {
          status: "completed",
          score: 0.9,
          passed: true,
          judgeCall: {
            status: "completed",
            provider: "deepseek",
            model: "deepseek-flash",
            promptContentRef: expect.any(String),
            responseContentRef: expect.any(String),
            inputTokens: 40,
            outputTokens: 12,
          },
        },
      ],
    });
  });
});
