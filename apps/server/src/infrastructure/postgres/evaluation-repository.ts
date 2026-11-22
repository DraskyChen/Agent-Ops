import type {
  EvaluationCaseResult,
  EvaluationCaseStatus,
  EvaluationDetail,
  EvaluationStatus,
  EvaluationSummary,
  EvaluationTraceSelector,
  EvaluatorDefinition,
} from "@agent-ops/contracts";
import type { Pool, PoolClient } from "pg";

import type { HumanPrincipal } from "../../application/auth.js";
import {
  EvaluationCaseAmbiguousError,
  EvaluationNotFoundError,
  EvaluationValidationError,
  type EvaluationRepository,
  type NormalizedEvaluationCreate,
} from "../../application/evaluations.js";

export function createPostgresEvaluationRepository(
  pool: Pool,
): EvaluationRepository {
  return {
    async list() {
      const result = await pool.query<EvaluationSummaryRow>(summaryQuery(), [
        null,
      ]);
      return result.rows.map(mapEvaluationSummary);
    },

    async get(evaluationId) {
      return loadEvaluation(pool, evaluationId);
    },

    async create(principal, input) {
      const client = await pool.connect();
      let evaluationId: string | undefined;
      try {
        await client.query("begin");
        const dataset = await client.query<DatasetRevisionRow>(
          `select
            r.id as revision_id, r.dataset_id, r.revision, d.name as dataset_name
          from dataset_revisions r
          join datasets d on d.id = r.dataset_id
          where r.id = $1`,
          [input.datasetRevisionId],
        );
        const datasetRow = dataset.rows[0];
        if (datasetRow === undefined) {
          throw new EvaluationValidationError("Dataset revision not found");
        }

        const evaluator = await ensureEvaluatorVersion(
          client,
          principal,
          input.evaluator,
        );
        const items = await client.query<DatasetItemRow>(
          `select id, case_id
           from dataset_items
           where dataset_revision_id = $1
           order by case_id`,
          [input.datasetRevisionId],
        );
        if (items.rows.length === 0) {
          throw new EvaluationValidationError(
            "Dataset revision has no items",
          );
        }
        const candidateTraceByCaseId = await matchCandidateTraces(
          client,
          input,
          items.rows.map((item) => item.case_id),
        );

        const run = await client.query<{ id: string }>(
          `insert into evaluation_runs (
            dataset_revision_id, evaluator_version_id, trace_selector,
            requested_by_subject, requested_by_name, total_cases,
            missing_cases
          ) values ($1, $2, $3, $4, $5, $6, $7)
          returning id`,
          [
            input.datasetRevisionId,
            evaluator.id,
            JSON.stringify(input.traceSelector),
            principal.subject,
            principal.displayName,
            items.rows.length,
            items.rows.filter(
              (item) => !candidateTraceByCaseId.has(item.case_id),
            ).length,
          ],
        );
        evaluationId = run.rows[0]?.id;
        if (evaluationId === undefined) {
          throw new Error("Evaluation run insert did not return an id");
        }

        for (const item of items.rows) {
          const candidate = candidateTraceByCaseId.get(item.case_id);
          await client.query(
            `insert into evaluation_cases (
              evaluation_run_id, dataset_item_id, case_id,
              candidate_trace_id, candidate_output_content_ref, status
            ) values ($1, $2, $3, $4, $5, $6)`,
            [
              evaluationId,
              item.id,
              item.case_id,
              candidate?.trace_id ?? null,
              candidate?.output_content_ref ?? null,
              candidate === undefined ? "missing" : "pending",
            ],
          );
        }
        await client.query(
          `insert into evaluation_jobs (evaluation_run_id)
           values ($1)`,
          [evaluationId],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }

      const evaluation = await loadEvaluation(pool, evaluationId);
      if (evaluation === null) {
        throw new Error("Created evaluation could not be loaded");
      }
      return evaluation;
    },

    async cancel(evaluationId) {
      const result = await pool.query(
        `update evaluation_runs set
          status = 'cancelled',
          completed_at = now()
        where id = $1 and status in ('queued', 'running')
        returning id`,
        [evaluationId],
      );
      if (result.rowCount === 0) {
        const existing = await pool.query(
          "select 1 from evaluation_runs where id = $1",
          [evaluationId],
        );
        if (existing.rowCount === 0) {
          throw new EvaluationNotFoundError();
        }
      } else {
        await pool.query(
          `update evaluation_jobs set
            state = 'completed',
            completed_at = now()
          where evaluation_run_id = $1`,
          [evaluationId],
        );
      }
      return loadEvaluation(pool, evaluationId);
    },
  };
}

async function ensureEvaluatorVersion(
  client: PoolClient,
  principal: HumanPrincipal,
  evaluator: EvaluatorDefinition,
): Promise<{ id: string; kind: string; config: unknown }> {
  const existing = await client.query<EvaluatorRow>(
    `select id, name, version, kind, config
     from evaluator_versions
     where name = $1 and version = $2`,
    [evaluator.name, evaluator.version],
  );
  const row = existing.rows[0];
  if (row !== undefined) {
    if (
      row.kind !== evaluator.kind ||
      canonicalJson(row.config) !== canonicalJson(evaluator.config)
    ) {
      throw new EvaluationValidationError(
        `Evaluator ${evaluator.name} v${evaluator.version} already exists with a different definition`,
      );
    }
    return row;
  }
  try {
    const inserted = await client.query<EvaluatorRow>(
      `insert into evaluator_versions (
        name, version, kind, config, created_by_subject, created_by_name
      ) values ($1, $2, $3, $4, $5, $6)
      returning id, name, version, kind, config`,
      [
        evaluator.name,
        evaluator.version,
        evaluator.kind,
        JSON.stringify(evaluator.config),
        principal.subject,
        principal.displayName,
      ],
    );
    const insertedRow = inserted.rows[0];
    if (insertedRow === undefined) {
      throw new Error("Evaluator insert did not return a row");
    }
    return insertedRow;
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    throw new EvaluationValidationError(
      `Evaluator ${evaluator.name} v${evaluator.version} was created concurrently; retry the request`,
    );
  }
}

async function matchCandidateTraces(
  client: PoolClient,
  input: NormalizedEvaluationCreate,
  caseIds: string[],
): Promise<Map<string, CandidateTraceRow>> {
  const values: unknown[] = [caseIds, input.traceSelector.startedAfter];
  const conditions = [
    "t.eval_case_id = any($1::text[])",
    "t.ingest_state = 'sealed_complete'",
    "t.start_time >= $2",
  ];
  const selector = input.traceSelector;
  if (selector.startedBefore !== undefined) {
    values.push(selector.startedBefore);
    conditions.push(`t.start_time < $${values.length}`);
  }
  for (const [column, value] of [
    ["t.app_name", selector.appName],
    ["t.prompt_version", selector.promptVersion],
    ["t.service_version", selector.serviceVersion],
    ["t.environment", selector.environment],
  ] as const) {
    if (value !== undefined) {
      values.push(value);
      conditions.push(`${column} = $${values.length}`);
    }
  }
  const result = await client.query<CandidateTraceRow>(
    `select
      t.trace_id, t.eval_case_id, s.output_content_ref
    from traces t
    join spans s
      on s.trace_id = t.trace_id and s.span_id = t.root_span_id
    where ${conditions.join(" and ")}
    order by t.start_time desc, t.trace_id desc`,
    values,
  );
  const matches = new Map<string, CandidateTraceRow>();
  for (const row of result.rows) {
    if (row.eval_case_id === null) {
      continue;
    }
    if (matches.has(row.eval_case_id)) {
      throw new EvaluationCaseAmbiguousError(
        `Multiple candidate traces match eval case ${row.eval_case_id}`,
      );
    }
    matches.set(row.eval_case_id, row);
  }
  return matches;
}

async function loadEvaluation(
  pool: Pool,
  evaluationId: string,
): Promise<EvaluationDetail | null> {
  const summary = await pool.query<EvaluationSummaryRow>(summaryQuery(), [
    evaluationId,
  ]);
  const row = summary.rows[0];
  if (row === undefined) {
    return null;
  }
  const cases = await pool.query<EvaluationCaseRow>(
    `select
      c.id as evaluation_case_id, c.dataset_item_id, c.case_id,
      c.candidate_trace_id, c.status, c.score, c.passed, c.reason, c.error,
      j.status as judge_status, j.provider as judge_provider,
      j.model as judge_model, j.prompt_content_ref, j.response_content_ref,
      j.input_tokens as judge_input_tokens,
      j.output_tokens as judge_output_tokens,
      j.cost_micros as judge_cost_micros
    from evaluation_cases c
    left join judge_calls j
      on j.evaluation_run_id = c.evaluation_run_id
      and j.evaluation_case_id = c.id
    where c.evaluation_run_id = $1
    order by c.case_id`,
    [evaluationId],
  );
  return {
    ...mapEvaluationSummary(row),
    traceSelector: row.trace_selector as EvaluationTraceSelector,
    cases: cases.rows.map(mapEvaluationCase),
  };
}

function summaryQuery(): string {
  return `select
    e.id as evaluation_id, d.id as dataset_id, d.name as dataset_name,
    r.id as dataset_revision_id, r.revision as dataset_revision,
    v.name as evaluator_name, v.version as evaluator_version,
    v.kind as evaluator_kind, e.trace_selector, e.status, e.total_cases,
    e.scored_cases, e.passed_cases, e.failed_cases, e.missing_cases,
    e.unscorable_cases, e.errored_cases, e.average_score,
    e.requested_by_name, e.created_at, e.started_at, e.completed_at,
    e.last_error
  from evaluation_runs e
  join dataset_revisions r on r.id = e.dataset_revision_id
  join datasets d on d.id = r.dataset_id
  join evaluator_versions v on v.id = e.evaluator_version_id
  where ($1::uuid is null or e.id = $1)
  order by e.created_at desc, e.id desc`;
}

interface EvaluatorRow {
  id: string;
  name: string;
  version: number;
  kind: string;
  config: unknown;
}

interface DatasetRevisionRow {
  revision_id: string;
  dataset_id: string;
  revision: number;
  dataset_name: string;
}

interface DatasetItemRow {
  id: string;
  case_id: string;
}

interface CandidateTraceRow {
  trace_id: string;
  eval_case_id: string | null;
  output_content_ref: string | null;
}

interface EvaluationSummaryRow {
  evaluation_id: string;
  dataset_id: string;
  dataset_name: string;
  dataset_revision_id: string;
  dataset_revision: number;
  evaluator_name: string;
  evaluator_version: number;
  evaluator_kind: EvaluatorDefinition["kind"];
  trace_selector: unknown;
  status: string;
  total_cases: number;
  scored_cases: number;
  passed_cases: number;
  failed_cases: number;
  missing_cases: number;
  unscorable_cases: number;
  errored_cases: number;
  average_score: number | null;
  requested_by_name: string;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  last_error: string | null;
}

interface EvaluationCaseRow {
  evaluation_case_id: string;
  dataset_item_id: string;
  case_id: string;
  candidate_trace_id: string | null;
  status: string;
  score: number | null;
  passed: boolean | null;
  reason: string | null;
  error: string | null;
  judge_status: "pending" | "completed" | "failed" | null;
  judge_provider: "deepseek" | null;
  judge_model: string | null;
  prompt_content_ref: string | null;
  response_content_ref: string | null;
  judge_input_tokens: string | null;
  judge_output_tokens: string | null;
  judge_cost_micros: string | null;
}

function mapEvaluationSummary(row: EvaluationSummaryRow): EvaluationSummary {
  return {
    evaluationId: row.evaluation_id,
    datasetId: row.dataset_id,
    datasetName: row.dataset_name,
    datasetRevisionId: row.dataset_revision_id,
    datasetRevision: row.dataset_revision,
    evaluatorName: row.evaluator_name,
    evaluatorVersion: row.evaluator_version,
    evaluatorKind: row.evaluator_kind,
    status: normalizeEvaluationStatus(row.status),
    totalCases: row.total_cases,
    scoredCases: row.scored_cases,
    passedCases: row.passed_cases,
    failedCases: row.failed_cases,
    missingCases: row.missing_cases,
    unscorableCases: row.unscorable_cases,
    erroredCases: row.errored_cases,
    averageScore:
      row.average_score === null ? null : Number(row.average_score),
    requestedBy: row.requested_by_name,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    completedAt: row.completed_at?.toISOString() ?? null,
    lastError: row.last_error,
  };
}

function mapEvaluationCase(row: EvaluationCaseRow): EvaluationCaseResult {
  return {
    evaluationCaseId: row.evaluation_case_id,
    datasetItemId: row.dataset_item_id,
    caseId: row.case_id,
    candidateTraceId: row.candidate_trace_id,
    status: normalizeCaseStatus(row.status),
    score: row.score === null ? null : Number(row.score),
    passed: row.passed,
    reason: row.reason,
    error: row.error,
    judgeCall:
      row.judge_status === null ||
      row.judge_provider === null ||
      row.judge_model === null
        ? null
        : {
            status: row.judge_status,
            provider: row.judge_provider,
            model: row.judge_model,
            promptContentRef: row.prompt_content_ref,
            responseContentRef: row.response_content_ref,
            inputTokens:
              row.judge_input_tokens === null
                ? null
                : Number(row.judge_input_tokens),
            outputTokens:
              row.judge_output_tokens === null
                ? null
                : Number(row.judge_output_tokens),
            costMicros:
              row.judge_cost_micros === null
                ? null
                : Number(row.judge_cost_micros),
          },
  };
}

function normalizeEvaluationStatus(value: string): EvaluationStatus {
  return value === "running" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
    ? value
    : "queued";
}

function normalizeCaseStatus(value: string): EvaluationCaseStatus {
  return value === "missing" ||
    value === "unscorable" ||
    value === "completed" ||
    value === "failed"
    ? value
    : "pending";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}

