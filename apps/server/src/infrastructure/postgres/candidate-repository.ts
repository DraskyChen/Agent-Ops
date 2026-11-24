import type {
  CandidateReason,
  Environment,
  FeedbackType,
  ReviewIssueArea,
  ReviewState,
  RunStatus,
  TraceCandidate,
  TraceIngestState,
} from "@agent-ops/contracts";
import {
  isRunStatus,
  isTraceIngestState,
  normalizeTaskType,
} from "@agent-ops/contracts";
import type { Pool } from "pg";

import type { HumanPrincipal } from "../../application/auth.js";
import type { CandidateRepository } from "../../application/candidates.js";

export function createPostgresCandidateRepository(
  pool: Pool,
): CandidateRepository {
  return {
    async list(startedAfter) {
      const result = await pool.query<CandidateRow>(
        `with negative_feedback as (
           select trace_id, array_agg(distinct type order by type) as feedback_types
           from feedback
           where type in ('thumbs_down', 'retry', 'abandon')
           group by trace_id
         ),
         latest_review as (
           select distinct on (trace_id)
             trace_id, status, issue_area
           from trace_reviews
           order by trace_id, created_at desc, id desc
         ),
         evaluation_summary as (
           select
             candidate_trace_id as trace_id,
             count(*) filter (
               where status = 'failed'
                 or (status = 'completed' and passed = false)
             )::integer as evaluation_failure_count,
             count(*) filter (
               where status in ('missing', 'unscorable')
             )::integer as evaluation_blocked_count
           from evaluation_cases
           where candidate_trace_id is not null
           group by candidate_trace_id
         ),
         dataset_membership as (
           select
             i.source_trace_id as trace_id,
             count(distinct r.dataset_id)::integer as dataset_count
           from dataset_items i
           join dataset_revisions r on r.id = i.dataset_revision_id
           group by i.source_trace_id
         ),
         root_content as (
           select
             t.trace_id, s.input_content_ref, s.output_content_ref
           from traces t
           join spans s
             on s.trace_id = t.trace_id and s.span_id = t.root_span_id
         ),
         candidate_rows as (
           select
             t.trace_id, t.run_name, t.session_id, t.app_name,
             t.service_version, t.task_type, t.model, t.prompt_version,
             t.eval_case_id, t.environment, t.run_status, t.duration_ms,
             t.cost_micros, t.input_tokens, t.output_tokens, t.step_count,
             t.tool_error_count, t.start_time, t.ingest_state,
             coalesce(nf.feedback_types, '{}'::text[]) as feedback_types,
             lr.status as review_status, lr.issue_area as review_issue_area,
             coalesce(es.evaluation_failure_count, 0)::integer
               as evaluation_failure_count,
             coalesce(es.evaluation_blocked_count, 0)::integer
               as evaluation_blocked_count,
             coalesce(dm.dataset_count, 0)::integer as dataset_count,
             (
               t.ingest_state = 'sealed_complete'
               and rc.input_content_ref is not null
               and rc.output_content_ref is not null
             ) as dataset_eligible,
             d.created_at as dismissed_at,
             d.dismissed_by_name,
             array_remove(array[
               case when nf.trace_id is not null then 'negative_feedback' end,
               case when lr.status = 'open' then 'review_open' end,
               case
                 when coalesce(t.tool_error_count, 0) > 0
                   or t.run_status in ('failed', 'timeout', 'partial')
                 then 'runtime_failure'
               end,
               case
                 when coalesce(es.evaluation_failure_count, 0) > 0
                 then 'evaluation_failed'
               end,
               case
                 when coalesce(es.evaluation_blocked_count, 0) > 0
                 then 'evaluation_blocked'
               end
             ], null) as reasons
           from traces t
           left join negative_feedback nf on nf.trace_id = t.trace_id
           left join latest_review lr on lr.trace_id = t.trace_id
           left join evaluation_summary es on es.trace_id = t.trace_id
           left join dataset_membership dm on dm.trace_id = t.trace_id
           left join root_content rc on rc.trace_id = t.trace_id
           left join trace_candidate_dismissals d on d.trace_id = t.trace_id
           where t.start_time >= $1
         )
         select *
         from candidate_rows
         where cardinality(reasons) > 0
         order by dismissed_at nulls first, start_time desc, trace_id desc
         limit 500`,
        [startedAfter],
      );
      return result.rows.map(mapCandidate);
    },

    async dismiss(traceId, principal, reason, now) {
      const result = await pool.query(
        `insert into trace_candidate_dismissals (
           trace_id, dismissed_by_subject, dismissed_by_name, reason, created_at
         )
         select trace_id, $2, $3, $4, $5
         from traces
         where trace_id = $1
         on conflict (trace_id) do update set
           dismissed_by_subject = excluded.dismissed_by_subject,
           dismissed_by_name = excluded.dismissed_by_name,
           reason = excluded.reason,
           created_at = excluded.created_at`,
        [
          traceId,
          principal.subject,
          principal.displayName,
          reason,
          now,
        ],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async restore(traceId) {
      const result = await pool.query(
        `delete from trace_candidate_dismissals
         where trace_id = $1`,
        [traceId],
      );
      return (result.rowCount ?? 0) > 0;
    },
  };
}

interface CandidateRow {
  trace_id: string;
  run_name: string | null;
  session_id: string | null;
  app_name: string | null;
  service_version: string | null;
  task_type: string | null;
  model: string | null;
  prompt_version: string | null;
  eval_case_id: string | null;
  environment: string | null;
  run_status: string | null;
  duration_ms: string | null;
  cost_micros: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
  step_count: number | null;
  tool_error_count: number | null;
  start_time: Date | null;
  ingest_state: string;
  feedback_types: string[];
  review_status: string | null;
  review_issue_area: string | null;
  evaluation_failure_count: number;
  evaluation_blocked_count: number;
  dataset_count: number;
  dataset_eligible: boolean;
  dismissed_at: Date | null;
  dismissed_by_name: string | null;
  reasons: string[];
}

function mapCandidate(row: CandidateRow): TraceCandidate {
  return {
    traceId: row.trace_id,
    runName: row.run_name ?? "Untitled agent run",
    sessionId: row.session_id,
    appName: row.app_name,
    serviceVersion: row.service_version,
    taskType:
      row.task_type === null ? null : normalizeTaskType(row.task_type),
    model: row.model,
    promptVersion: row.prompt_version,
    evalCaseId: row.eval_case_id,
    environment: normalizeEnvironment(row.environment),
    runStatus: normalizeRunStatus(row.run_status),
    latencyMs: numberOrNull(row.duration_ms),
    costMicros: numberOrNull(row.cost_micros),
    inputTokens: numberOrNull(row.input_tokens),
    outputTokens: numberOrNull(row.output_tokens),
    stepCount: row.step_count,
    toolErrorCount: row.tool_error_count,
    reviewStatus: normalizeReviewState(row.review_status),
    startedAt: row.start_time?.toISOString() ?? null,
    ingestState: isTraceIngestState(row.ingest_state)
      ? row.ingest_state
      : "open",
    reasons: row.reasons.filter(isCandidateReason),
    feedbackTypes: row.feedback_types.filter(isFeedbackType),
    reviewIssueArea: isReviewIssueArea(row.review_issue_area)
      ? row.review_issue_area
      : null,
    evaluationFailureCount: row.evaluation_failure_count,
    evaluationBlockedCount: row.evaluation_blocked_count,
    datasetCount: row.dataset_count,
    datasetEligible: row.dataset_eligible,
    dismissedAt: row.dismissed_at?.toISOString() ?? null,
    dismissedBy: row.dismissed_by_name,
  };
}

function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
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

function normalizeReviewState(value: string | null): ReviewState {
  if (value === "open" || value === "resolved" || value === "ignored") {
    return value;
  }
  return "unreviewed";
}

function isCandidateReason(value: string): value is CandidateReason {
  return (
    value === "negative_feedback" ||
    value === "review_open" ||
    value === "runtime_failure" ||
    value === "evaluation_failed" ||
    value === "evaluation_blocked"
  );
}

function isFeedbackType(value: string): value is FeedbackType {
  return (
    value === "thumbs_up" ||
    value === "thumbs_down" ||
    value === "retry" ||
    value === "abandon" ||
    value === "comment"
  );
}

function isReviewIssueArea(value: string | null): value is ReviewIssueArea {
  return (
    value === "prompt" ||
    value === "model" ||
    value === "tool" ||
    value === "retrieval" ||
    value === "data" ||
    value === "infrastructure" ||
    value === "other"
  );
}
