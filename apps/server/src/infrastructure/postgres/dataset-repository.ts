import {
  isRunStatus,
  type DatasetDetail,
  type DatasetItem,
  type DatasetRevisionDetail,
  type DatasetRevisionSummary,
  type DatasetSummary,
  type Environment,
  type RunStatus,
} from "@agent-ops/contracts";
import type { Pool, PoolClient } from "pg";

import type { HumanPrincipal } from "../../application/auth.js";
import {
  DatasetCaseConflictError,
  DatasetNameConflictError,
  DatasetNotFoundError,
  type DatasetRepository,
  type DatasetTraceSnapshot,
  type NormalizedDatasetCreate,
  type NormalizedDatasetRevision,
} from "../../application/datasets.js";

export function createPostgresDatasetRepository(pool: Pool): DatasetRepository {
  return {
    async list() {
      const result = await pool.query<DatasetSummaryRow>(
        `select
          d.id as dataset_id, d.name, d.description,
          latest.revision as latest_revision,
          coalesce(latest.item_count, 0)::integer as item_count,
          d.created_by_name, d.created_at, d.updated_at
        from datasets d
        left join lateral (
          select
            r.revision,
            (select count(*) from dataset_items i
             where i.dataset_revision_id = r.id) as item_count
          from dataset_revisions r
          where r.dataset_id = d.id
          order by r.revision desc
          limit 1
        ) latest on true
        order by d.updated_at desc, d.id desc`,
      );
      return result.rows.map(mapDatasetSummary);
    },

    async get(datasetId) {
      const datasetResult = await pool.query<DatasetSummaryRow>(
        `select
          d.id as dataset_id, d.name, d.description,
          latest.revision as latest_revision,
          coalesce(latest.item_count, 0)::integer as item_count,
          d.created_by_name, d.created_at, d.updated_at
        from datasets d
        left join lateral (
          select
            r.revision,
            (select count(*) from dataset_items i
             where i.dataset_revision_id = r.id) as item_count
          from dataset_revisions r
          where r.dataset_id = d.id
          order by r.revision desc
          limit 1
        ) latest on true
        where d.id = $1`,
        [datasetId],
      );
      const dataset = datasetResult.rows[0];
      if (dataset === undefined) {
        return null;
      }
      const revisions = await pool.query<DatasetRevisionRow>(
        `select
          r.id as revision_id, r.dataset_id, r.revision, r.note,
          r.created_by_name, r.created_at,
          (select count(*) from dataset_items i
           where i.dataset_revision_id = r.id)::integer as item_count
        from dataset_revisions r
        where r.dataset_id = $1
        order by r.revision desc`,
        [datasetId],
      );
      return {
        ...mapDatasetSummary(dataset),
        revisions: revisions.rows.map(mapRevisionSummary),
      };
    },

    async create(principal, input) {
      try {
        const result = await pool.query<DatasetSummaryRow>(
          `with inserted as (
            insert into datasets (
              name, description, created_by_subject, created_by_name
            ) values ($1, $2, $3, $4)
            returning *
          )
          select
            id as dataset_id, name, description, null::integer as latest_revision,
            0::integer as item_count, created_by_name, created_at, updated_at
          from inserted`,
          [
            input.name,
            input.description,
            principal.subject,
            principal.displayName,
          ],
        );
        const row = result.rows[0];
        if (row === undefined) {
          throw new Error("Dataset insert did not return a row");
        }
        return mapDatasetSummary(row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DatasetNameConflictError();
        }
        throw error;
      }
    },

    async loadTraceSnapshots(traceIds) {
      if (traceIds.length === 0) {
        return [];
      }
      const result = await pool.query<TraceSnapshotRow>(
        `select
          t.trace_id, t.app_name, t.prompt_version, t.eval_case_id,
          t.task_type, t.model, t.environment, t.run_status, t.start_time,
          t.ingest_state, s.input_content_ref, s.output_content_ref
        from traces t
        left join spans s
          on s.trace_id = t.trace_id and s.span_id = t.root_span_id
        where t.trace_id = any($1::text[])`,
        [traceIds],
      );
      return result.rows.map(mapTraceSnapshot);
    },

    async createRevision(datasetId, principal, input) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const exists = await client.query(
          "select id from datasets where id = $1 for update",
          [datasetId],
        );
        if (exists.rowCount === 0) {
          throw new DatasetNotFoundError();
        }
        const revisionResult = await client.query<{ revision: number }>(
          `select coalesce(max(revision), 0) + 1 as revision
           from dataset_revisions
           where dataset_id = $1`,
          [datasetId],
        );
        const revision = revisionResult.rows[0]?.revision;
        if (revision === undefined) {
          throw new Error("Could not allocate dataset revision");
        }
        const created = await client.query<DatasetRevisionRow>(
          `insert into dataset_revisions (
            dataset_id, revision, note, created_by_subject, created_by_name
          ) values ($1, $2, $3, $4, $5)
          returning
            id as revision_id, dataset_id, revision, note, created_by_name,
            created_at, $6::integer as item_count`,
          [
            datasetId,
            revision,
            input.note,
            principal.subject,
            principal.displayName,
            input.items.length,
          ],
        );
        const revisionRow = created.rows[0];
        if (revisionRow === undefined) {
          throw new Error("Dataset revision insert did not return a row");
        }

        const items: DatasetItem[] = [];
        for (const item of input.items) {
          const inserted = await client.query<DatasetItemRow>(
            `insert into dataset_items (
              dataset_revision_id, case_id, source_trace_id, app_name,
              prompt_version, task_type, model, environment, run_status,
              source_started_at, input_content_ref, baseline_output_content_ref,
              expected_output_content_ref, expected_behavior, tags
            ) values (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
              $15
            )
            returning
              id as item_id, case_id, source_trace_id, app_name,
              prompt_version, task_type, model, environment, run_status,
              source_started_at, input_content_ref, baseline_output_content_ref,
              expected_output_content_ref, expected_behavior, tags`,
            [
              revisionRow.revision_id,
              item.caseId,
              item.sourceTraceId,
              item.appName,
              item.promptVersion,
              item.taskType,
              item.model,
              item.environment,
              item.runStatus,
              item.sourceStartedAt === null
                ? null
                : new Date(item.sourceStartedAt),
              item.inputContentRef,
              item.baselineOutputContentRef,
              item.expectedOutputContentRef,
              item.expectedBehavior,
              JSON.stringify(item.tags),
            ],
          );
          const insertedItem = inserted.rows[0];
          if (insertedItem === undefined) {
            throw new Error("Dataset item insert did not return a row");
          }
          items.push(mapDatasetItem(insertedItem));
        }
        await client.query(
          "update datasets set updated_at = now() where id = $1",
          [datasetId],
        );
        await client.query("commit");
        return {
          ...mapRevisionSummary(revisionRow),
          items,
        };
      } catch (error) {
        await client.query("rollback");
        if (isUniqueViolation(error)) {
          throw new DatasetCaseConflictError(
            "A caseId already exists in this dataset revision",
          );
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}

interface DatasetSummaryRow {
  dataset_id: string;
  name: string;
  description: string | null;
  latest_revision: number | null;
  item_count: number;
  created_by_name: string;
  created_at: Date;
  updated_at: Date;
}

interface DatasetRevisionRow {
  revision_id: string;
  dataset_id: string;
  revision: number;
  item_count: number;
  note: string | null;
  created_by_name: string;
  created_at: Date;
}

interface DatasetItemRow {
  item_id: string;
  case_id: string;
  source_trace_id: string;
  app_name: string | null;
  prompt_version: string | null;
  task_type: string | null;
  model: string | null;
  environment: string | null;
  run_status: string | null;
  source_started_at: Date | null;
  input_content_ref: string;
  baseline_output_content_ref: string;
  expected_output_content_ref: string | null;
  expected_behavior: string | null;
  tags: unknown;
}

interface TraceSnapshotRow {
  trace_id: string;
  app_name: string | null;
  prompt_version: string | null;
  eval_case_id: string | null;
  task_type: string | null;
  model: string | null;
  environment: string | null;
  run_status: string | null;
  start_time: Date | null;
  ingest_state: string;
  input_content_ref: string | null;
  output_content_ref: string | null;
}

function mapDatasetSummary(row: DatasetSummaryRow): DatasetSummary {
  return {
    datasetId: row.dataset_id,
    name: row.name,
    description: row.description,
    latestRevision: row.latest_revision,
    itemCount: row.item_count,
    createdBy: row.created_by_name,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapRevisionSummary(
  row: DatasetRevisionRow,
): DatasetRevisionSummary {
  return {
    revisionId: row.revision_id,
    datasetId: row.dataset_id,
    revision: row.revision,
    itemCount: row.item_count,
    note: row.note,
    createdBy: row.created_by_name,
    createdAt: row.created_at.toISOString(),
  };
}

function mapDatasetItem(row: DatasetItemRow): DatasetItem {
  return {
    itemId: row.item_id,
    caseId: row.case_id,
    sourceTraceId: row.source_trace_id,
    appName: row.app_name,
    promptVersion: row.prompt_version,
    taskType: row.task_type,
    model: row.model,
    environment: normalizeEnvironment(row.environment),
    runStatus: normalizeRunStatus(row.run_status),
    sourceStartedAt: row.source_started_at?.toISOString() ?? null,
    inputContentRef: row.input_content_ref,
    baselineOutputContentRef: row.baseline_output_content_ref,
    expectedOutputContentRef: row.expected_output_content_ref,
    expectedBehavior: row.expected_behavior,
    tags: Array.isArray(row.tags)
      ? row.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

function mapTraceSnapshot(row: TraceSnapshotRow): DatasetTraceSnapshot {
  return {
    traceId: row.trace_id,
    appName: row.app_name,
    promptVersion: row.prompt_version,
    evalCaseId: row.eval_case_id,
    taskType: row.task_type,
    model: row.model,
    environment: normalizeEnvironment(row.environment),
    runStatus: normalizeRunStatus(row.run_status),
    sourceStartedAt: row.start_time?.toISOString() ?? null,
    ingestState: row.ingest_state,
    inputContentRef: row.input_content_ref,
    outputContentRef: row.output_content_ref,
  };
}

function normalizeEnvironment(value: string | null): Environment | null {
  return value === "prod" ||
    value === "staging" ||
    value === "dev" ||
    value === "test"
    ? value
    : null;
}

function normalizeRunStatus(value: string | null): RunStatus | null {
  return value !== null && isRunStatus(value) ? value : null;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
