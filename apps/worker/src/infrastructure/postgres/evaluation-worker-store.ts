import type { RuleEvaluatorDefinition } from "@agent-ops/contracts";
import type { Pool } from "pg";

import type {
  EvaluationWork,
  EvaluationWorkCase,
  EvaluationWorkerStore,
  RuleResultWrite,
} from "../../application/evaluate-rule-run.js";
import type { ObjectTextReader } from "../minio/object-reader.js";

export function createPostgresEvaluationWorkerStore(
  pool: Pool,
  reader: ObjectTextReader,
): EvaluationWorkerStore {
  return {
    async claimNextRun() {
      const client = await pool.connect();
      let evaluationId: string | null = null;
      try {
        await client.query("begin");
        const claimed = await client.query<{ evaluation_run_id: string }>(
          `select j.evaluation_run_id
           from evaluation_jobs j
           join evaluation_runs e on e.id = j.evaluation_run_id
           where j.state = 'pending' and e.status = 'queued'
           order by j.requested_at, j.evaluation_run_id
           for update of j skip locked
           limit 1`,
        );
        evaluationId = claimed.rows[0]?.evaluation_run_id ?? null;
        if (evaluationId !== null) {
          await client.query(
            `update evaluation_jobs set
              state = 'processing',
              started_at = now(),
              attempt_count = attempt_count + 1,
              last_error = null
            where evaluation_run_id = $1`,
            [evaluationId],
          );
          await client.query(
            `update evaluation_runs set
              status = 'running',
              started_at = coalesce(started_at, now()),
              completed_at = null,
              last_error = null
            where id = $1 and status = 'queued'`,
            [evaluationId],
          );
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
      if (evaluationId === null) {
        return null;
      }
      return loadWork(pool, evaluationId);
    },

    async readText(contentId) {
      const result = await pool.query<ContentRow>(
        `select object_key, status, expires_at
         from content_objects
         where content_id = $1`,
        [contentId],
      );
      const row = result.rows[0];
      if (
        row === undefined ||
        row.status !== "available" ||
        (row.expires_at !== null && row.expires_at <= new Date())
      ) {
        return null;
      }
      return reader.readText(row.object_key);
    },

    async saveCaseResult(evaluationId, evaluatorVersionId, result) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const context = await client.query<CaseContextRow>(
          `select
            c.candidate_trace_id, v.name as evaluator_name,
            v.version as evaluator_version
          from evaluation_cases c
          join evaluation_runs e on e.id = c.evaluation_run_id
          join evaluator_versions v on v.id = e.evaluator_version_id
          where c.id = $1
            and e.id = $2
            and e.evaluator_version_id = $3
            and e.status = 'running'
          for update of c`,
          [result.evaluationCaseId, evaluationId, evaluatorVersionId],
        );
        const row = context.rows[0];
        if (row === undefined) {
          await client.query("commit");
          return;
        }

        await client.query(
          `update evaluation_cases set
            status = $2,
            score = $3,
            passed = $4,
            reason = $5,
            error = $6,
            updated_at = now()
          where id = $1`,
          [
            result.evaluationCaseId,
            result.status,
            result.score,
            result.passed,
            result.reason,
            result.error,
          ],
        );

        if (
          result.status === "completed" &&
          result.score !== null &&
          result.passed !== null &&
          row.candidate_trace_id !== null
        ) {
          await client.query(
            `insert into scores (
              trace_id, span_id, name, value, source, evaluator_version,
              comment, evaluation_run_id, dataset_item_id,
              evaluator_version_id
            )
            select
              $1, null, $2, $3::jsonb, 'rule', $4, $5, $6,
              c.dataset_item_id, $7
            from evaluation_cases c
            where c.id = $8
            on conflict (evaluation_run_id, dataset_item_id)
              where evaluation_run_id is not null and dataset_item_id is not null
            do update set
              value = excluded.value,
              comment = excluded.comment,
              evaluator_version = excluded.evaluator_version`,
            [
              row.candidate_trace_id,
              row.evaluator_name,
              JSON.stringify({
                score: result.score,
                pass: result.passed,
                reason: result.reason,
              }),
              `${row.evaluator_name}@v${row.evaluator_version}`,
              result.reason,
              evaluationId,
              evaluatorVersionId,
              result.evaluationCaseId,
            ],
          );
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async completeRun(evaluationId) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query(
          `update evaluation_cases set
            status = 'failed',
            error = coalesce(error, 'Worker did not produce a result'),
            updated_at = now()
          where evaluation_run_id = $1 and status = 'pending'`,
          [evaluationId],
        );
        await client.query(
          `update evaluation_runs e set
            status = 'completed',
            scored_cases = counts.scored_cases,
            passed_cases = counts.passed_cases,
            failed_cases = counts.failed_cases,
            missing_cases = counts.missing_cases,
            unscorable_cases = counts.unscorable_cases,
            errored_cases = counts.errored_cases,
            average_score = counts.average_score,
            completed_at = now(),
            last_error = null
          from (
            select
              count(*) filter (where status = 'completed')::integer
                as scored_cases,
              count(*) filter (where status = 'completed' and passed)::integer
                as passed_cases,
              count(*) filter (
                where status = 'completed' and passed = false
              )::integer as failed_cases,
              count(*) filter (where status = 'missing')::integer
                as missing_cases,
              count(*) filter (where status = 'unscorable')::integer
                as unscorable_cases,
              count(*) filter (where status = 'failed')::integer
                as errored_cases,
              avg(score) filter (where status = 'completed') as average_score
            from evaluation_cases
            where evaluation_run_id = $1
          ) counts
          where e.id = $1 and e.status = 'running'`,
          [evaluationId],
        );
        await client.query(
          `update evaluation_jobs set
            state = 'completed',
            completed_at = now(),
            last_error = null
          where evaluation_run_id = $1`,
          [evaluationId],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async markFailed(evaluationId, error) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const job = await client.query<{ attempt_count: number }>(
          `update evaluation_jobs set
            state = case
              when attempt_count >= 3 then 'failed'
              else 'pending'
            end,
            completed_at = case
              when attempt_count >= 3 then now()
              else null
            end,
            last_error = $2
          where evaluation_run_id = $1
          returning attempt_count`,
          [evaluationId, error.message],
        );
        const terminal = (job.rows[0]?.attempt_count ?? 0) >= 3;
        await client.query(
          `update evaluation_runs set
            status = case when $2 then 'failed' else 'queued' end,
            completed_at = case when $2 then now() else null end,
            last_error = $3
          where id = $1 and status <> 'cancelled'`,
          [evaluationId, terminal, error.message],
        );
        await client.query("commit");
      } catch (failure) {
        await client.query("rollback");
        throw failure;
      } finally {
        client.release();
      }
    },
  };
}

async function loadWork(
  pool: Pool,
  evaluationId: string,
): Promise<EvaluationWork> {
  const evaluator = await pool.query<EvaluatorWorkRow>(
    `select
      e.evaluator_version_id, v.name, v.version, v.kind, v.config
    from evaluation_runs e
    join evaluator_versions v on v.id = e.evaluator_version_id
    where e.id = $1`,
    [evaluationId],
  );
  const row = evaluator.rows[0];
  if (row === undefined) {
    throw new Error(`Evaluation ${evaluationId} disappeared`);
  }
  const cases = await pool.query<EvaluationWorkCaseRow>(
    `select
      c.id as evaluation_case_id, c.case_id, c.candidate_trace_id,
      i.expected_output_content_ref, c.candidate_output_content_ref,
      t.duration_ms, t.cost_micros, t.tool_error_count
    from evaluation_cases c
    join dataset_items i on i.id = c.dataset_item_id
    join traces t on t.trace_id = c.candidate_trace_id
    where c.evaluation_run_id = $1
      and c.status = 'pending'
      and c.candidate_trace_id is not null
    order by c.case_id`,
    [evaluationId],
  );
  return {
    evaluationId,
    evaluatorVersionId: row.evaluator_version_id,
    evaluator: {
      name: row.name,
      version: row.version,
      kind: row.kind,
      config: row.config,
    } as RuleEvaluatorDefinition,
    cases: cases.rows.map(mapWorkCase),
  };
}

interface CaseContextRow {
  candidate_trace_id: string | null;
  evaluator_name: string;
  evaluator_version: number;
}

interface ContentRow {
  object_key: string;
  status: string;
  expires_at: Date | null;
}

interface EvaluatorWorkRow {
  evaluator_version_id: string;
  name: string;
  version: number;
  kind: string;
  config: Record<string, unknown>;
}

interface EvaluationWorkCaseRow {
  evaluation_case_id: string;
  case_id: string;
  candidate_trace_id: string;
  expected_output_content_ref: string | null;
  candidate_output_content_ref: string | null;
  duration_ms: string | null;
  cost_micros: string | null;
  tool_error_count: number | null;
}

function mapWorkCase(row: EvaluationWorkCaseRow): EvaluationWorkCase {
  return {
    evaluationCaseId: row.evaluation_case_id,
    caseId: row.case_id,
    candidateTraceId: row.candidate_trace_id,
    expectedOutputContentRef: row.expected_output_content_ref,
    candidateOutputContentRef: row.candidate_output_content_ref,
    latencyMs: row.duration_ms === null ? null : Number(row.duration_ms),
    costMicros: row.cost_micros === null ? null : Number(row.cost_micros),
    toolErrorCount: row.tool_error_count,
  };
}
