import {
  isRunStatus,
  isTraceIngestState,
  normalizeSpanType,
  normalizeTaskType,
  type Environment,
  type FeedbackItem,
  type FeedbackType,
  type ReviewIssueArea,
  type ReviewItem,
  type ReviewState,
  type ReviewStatus,
  type SessionSummary,
  type TraceDetail,
  type TraceListItem,
  type TraceSpan,
} from "@agent-ops/contracts";
import type { Pool } from "pg";

import {
  encodeTraceCursor,
  type NormalizedTraceListQuery,
  type NormalizedSessionListQuery,
  type TraceReadRepository,
} from "../../application/traces.js";

export function createPostgresTraceReadRepository(
  pool: Pool,
): TraceReadRepository {
  return {
    async list(query) {
      const conditions: string[] = [
        "t.start_time is not null",
        "t.start_time >= $1",
      ];
      const values: unknown[] = [query.startedAfter];

      if (query.startedBefore !== undefined) {
        values.push(query.startedBefore);
        conditions.push(`t.start_time < $${values.length}`);
      }
      addExactFilter(conditions, values, "t.run_status", query.status);
      addExactFilter(conditions, values, "t.environment", query.environment);
      addExactFilter(conditions, values, "t.app_name", query.appName);
      addExactFilter(conditions, values, "t.task_type", query.taskType);
      addExactFilter(conditions, values, "t.model", query.model);
      addExactFilter(
        conditions,
        values,
        "t.prompt_version",
        query.promptVersion,
      );
      addExactFilter(conditions, values, "t.eval_case_id", query.evalCaseId);
      addExactFilter(
        conditions,
        values,
        "t.service_version",
        query.serviceVersion,
      );

      if (query.hasErrors === "true") {
        conditions.push(
          "(coalesce(t.tool_error_count, 0) > 0 or t.run_status in ('failed', 'partial', 'timeout'))",
        );
      } else if (query.hasErrors === "false") {
        conditions.push(
          "coalesce(t.tool_error_count, 0) = 0 and (t.run_status is null or t.run_status in ('success', 'cancelled'))",
        );
      }

      if (query.reviewStatus === "unreviewed") {
        conditions.push("latest_review.status is null");
      } else if (query.reviewStatus !== undefined) {
        values.push(query.reviewStatus);
        conditions.push(`latest_review.status = $${values.length}`);
      }

      if (query.search !== undefined) {
        values.push(`%${query.search}%`);
        const index = values.length;
        conditions.push(`(
          t.run_name ilike $${index}
          or t.trace_id ilike $${index}
          or t.task_type ilike $${index}
          or t.model ilike $${index}
          or t.session_id ilike $${index}
          or t.app_name ilike $${index}
        )`);
      }

      if (query.cursor !== undefined) {
        values.push(query.cursor.startedAt, query.cursor.traceId);
        conditions.push(
          `(t.start_time, t.trace_id) < ($${values.length - 1}, $${values.length})`,
        );
      }

      values.push(query.limit + 1);
      const result = await pool.query<TraceRow>(
        `select
          t.trace_id, t.run_name, t.session_id, t.app_name,
          t.service_version, t.task_type, t.model, t.prompt_version,
          t.eval_case_id,
          t.environment, t.run_status, t.duration_ms, t.cost_micros,
          t.input_tokens, t.output_tokens, t.step_count, t.tool_error_count,
          t.start_time, t.ingest_state,
          latest_review.status as review_status
        from traces t
        left join lateral (
          select status
          from trace_reviews
          where trace_id = t.trace_id
          order by created_at desc, id desc
          limit 1
        ) latest_review on true
        where ${conditions.join(" and ")}
        order by t.start_time desc, t.trace_id desc
        limit $${values.length}`,
        values,
      );

      const hasNextPage = result.rows.length > query.limit;
      const rows = result.rows.slice(0, query.limit);
      const last = rows.at(-1);
      return {
        items: rows.map(mapTraceListItem),
        nextCursor:
          hasNextPage && last !== undefined && last.start_time !== null
            ? encodeTraceCursor({
                startedAt: last.start_time.toISOString(),
                traceId: last.trace_id,
              })
            : null,
      };
    },

    async listSessions(query) {
      const values: unknown[] = [query.startedAfter];
      let searchCondition = "";
      if (query.search !== undefined) {
        values.push(`%${query.search}%`);
        const index = values.length;
        searchCondition = `where (
          session_id ilike $${index}
          or coalesce(app_name, '') ilike $${index}
          or coalesce(run_name, '') ilike $${index}
        )`;
      }
      values.push(query.limit);
      const limitIndex = values.length;
      const result = await pool.query<SessionSummaryRow>(
        `with recent_runs as (
           select
             trace_id, run_name, session_id, app_name, start_time,
             duration_ms, run_status, cost_micros, input_tokens,
             output_tokens, tool_error_count
           from traces
           where session_id is not null and start_time >= $1
         ),
         matching_sessions as (
           select distinct session_id
           from recent_runs
           ${searchCondition}
         ),
         filtered_runs as (
           select r.*
           from recent_runs r
           join matching_sessions m on m.session_id = r.session_id
         )
         select
           session_id,
           count(*)::integer as trace_count,
           min(start_time) as first_started_at,
           max(start_time + coalesce(duration_ms, 0) * interval '1 millisecond')
             as last_ended_at,
           round(extract(epoch from (
             max(start_time + coalesce(duration_ms, 0) * interval '1 millisecond')
             - min(start_time)
           )) * 1000)::bigint as duration_ms,
           coalesce(sum(cost_micros), 0)::bigint as total_cost_micros,
           coalesce(sum(input_tokens), 0)::bigint as input_tokens,
           coalesce(sum(output_tokens), 0)::bigint as output_tokens,
           coalesce(sum(tool_error_count), 0)::bigint as tool_error_count,
           count(*) filter (where run_status is null)::integer as unknown_count,
           count(*) filter (where run_status = 'success')::integer as success_count,
           count(*) filter (where run_status = 'failed')::integer as failed_count,
           count(*) filter (where run_status = 'partial')::integer as partial_count,
           count(*) filter (where run_status = 'cancelled')::integer as cancelled_count,
           count(*) filter (where run_status = 'timeout')::integer as timeout_count,
           array_remove(array_agg(distinct app_name), null) as app_names
         from filtered_runs
         group by session_id
         order by last_ended_at desc, session_id desc
         limit $${limitIndex}`,
        values,
      );
      return result.rows.map(mapSessionSummary);
    },

    async listBySession(sessionId) {
      const result = await pool.query<TraceRow>(
        `select
          t.trace_id, t.run_name, t.session_id, t.app_name,
          t.service_version, t.task_type, t.model, t.prompt_version,
          t.eval_case_id,
          t.environment, t.run_status, t.duration_ms, t.cost_micros,
          t.input_tokens, t.output_tokens, t.step_count, t.tool_error_count,
          t.start_time, t.ingest_state,
          latest_review.status as review_status
        from traces t
        left join lateral (
          select status
          from trace_reviews
          where trace_id = t.trace_id
          order by created_at desc, id desc
          limit 1
        ) latest_review on true
        where t.session_id = $1 and t.start_time is not null
        order by t.start_time asc, t.trace_id asc
        limit 500`,
        [sessionId],
      );
      return result.rows.map(mapTraceListItem);
    },

    async get(traceId) {
      const traceResult = await pool.query<TraceRow>(
        `select
          t.trace_id, t.run_name, t.session_id, t.app_name,
          t.service_version, t.task_type, t.model, t.prompt_version,
          t.eval_case_id,
          t.environment, t.run_status, t.duration_ms, t.cost_micros,
          t.input_tokens, t.output_tokens, t.step_count, t.tool_error_count,
          t.start_time, t.ingest_state, t.stop_reason,
          latest_review.status as review_status
        from traces t
        left join lateral (
          select status
          from trace_reviews
          where trace_id = t.trace_id
          order by created_at desc, id desc
          limit 1
        ) latest_review on true
        where t.trace_id = $1`,
        [traceId],
      );
      const trace = traceResult.rows[0];
      if (trace === undefined) {
        return null;
      }

      const [spans, feedback, reviews] = await Promise.all([
        pool.query<SpanRow>(
          `select
            span_id, parent_span_id, name, span_type, span_subtype, service_name,
            start_time, end_time, duration_ms, status, error_type, error_category,
            attributes, resource_attributes, input_tokens, output_tokens,
            cost_micros, input_content_ref, output_content_ref
          from spans
          where trace_id = $1
          order by start_time asc, span_id asc`,
          [traceId],
        ),
        pool.query<FeedbackRow>(
          `select
            id, trace_id, span_id, event_id, type, actor_ref, comment, created_at
          from feedback
          where trace_id = $1
          order by created_at desc, id desc
          limit 100`,
          [traceId],
        ),
        pool.query<ReviewRow>(
          `select
            id, trace_id, reviewer_subject, reviewer_name, status, issue_area,
            comment, created_at
          from trace_reviews
          where trace_id = $1
          order by created_at desc, id desc
          limit 100`,
          [traceId],
        ),
      ]);

      return {
        ...mapTraceListItem(trace),
        stopReason: trace.stop_reason,
        spans: spans.rows.map(mapTraceSpan),
        feedback: feedback.rows.map(mapFeedback),
        reviews: reviews.rows.map(mapReview),
      };
    },
  };
}

interface TraceRow {
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
  stop_reason: string | null;
  review_status: string | null;
}

interface SessionSummaryRow {
  session_id: string;
  trace_count: number;
  first_started_at: Date;
  last_ended_at: Date;
  duration_ms: string;
  total_cost_micros: string;
  input_tokens: string;
  output_tokens: string;
  tool_error_count: string;
  unknown_count: number;
  success_count: number;
  failed_count: number;
  partial_count: number;
  cancelled_count: number;
  timeout_count: number;
  app_names: string[];
}

interface SpanRow {
  span_id: string;
  parent_span_id: string | null;
  name: string;
  span_type: string;
  span_subtype: string | null;
  service_name: string | null;
  start_time: Date;
  end_time: Date;
  duration_ms: string;
  status: string;
  error_type: string | null;
  error_category: string | null;
  attributes: Record<string, unknown>;
  resource_attributes: Record<string, unknown>;
  input_tokens: string | null;
  output_tokens: string | null;
  cost_micros: string | null;
  input_content_ref: string | null;
  output_content_ref: string | null;
}

interface FeedbackRow {
  id: string;
  trace_id: string;
  span_id: string | null;
  event_id: string;
  type: string;
  actor_ref: string | null;
  comment: string | null;
  created_at: Date;
}

interface ReviewRow {
  id: string;
  trace_id: string;
  reviewer_subject: string;
  reviewer_name: string;
  status: string;
  issue_area: string | null;
  comment: string | null;
  created_at: Date;
}

function mapTraceListItem(row: TraceRow): TraceListItem {
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
    runStatus:
      row.run_status !== null && isRunStatus(row.run_status)
        ? row.run_status
        : null,
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
  };
}

function mapSessionSummary(row: SessionSummaryRow): SessionSummary {
  return {
    sessionId: row.session_id,
    traceCount: row.trace_count,
    firstStartedAt: row.first_started_at.toISOString(),
    lastEndedAt: row.last_ended_at.toISOString(),
    durationMs: Number(row.duration_ms),
    totalCostMicros: Number(row.total_cost_micros),
    inputTokens: Number(row.input_tokens),
    outputTokens: Number(row.output_tokens),
    toolErrorCount: Number(row.tool_error_count),
    statusCounts: {
      unknown: row.unknown_count,
      success: row.success_count,
      failed: row.failed_count,
      partial: row.partial_count,
      cancelled: row.cancelled_count,
      timeout: row.timeout_count,
    },
    appNames: row.app_names,
  };
}

function mapTraceSpan(row: SpanRow): TraceSpan {
  return {
    spanId: row.span_id,
    parentSpanId: row.parent_span_id,
    name: row.name,
    spanType: normalizeSpanType(row.span_type),
    spanSubtype: row.span_subtype,
    serviceName: row.service_name,
    startTime: row.start_time.toISOString(),
    endTime: row.end_time.toISOString(),
    durationMs: Number(row.duration_ms),
    status:
      row.status === "OK" || row.status === "ERROR" ? row.status : "UNSET",
    errorType: row.error_type,
    errorCategory: row.error_category,
    attributes: row.attributes,
    resourceAttributes: row.resource_attributes,
    inputTokens: numberOrNull(row.input_tokens),
    outputTokens: numberOrNull(row.output_tokens),
    costMicros: numberOrNull(row.cost_micros),
    inputContentRef: row.input_content_ref,
    outputContentRef: row.output_content_ref,
  };
}

function mapFeedback(row: FeedbackRow): FeedbackItem {
  return {
    feedbackId: row.id,
    traceId: row.trace_id,
    spanId: row.span_id,
    eventId: row.event_id,
    type: normalizeFeedbackType(row.type),
    actorRef: row.actor_ref,
    comment: row.comment,
    createdAt: row.created_at.toISOString(),
  };
}

function mapReview(row: ReviewRow): ReviewItem {
  return {
    reviewId: row.id,
    traceId: row.trace_id,
    reviewerSubject: row.reviewer_subject,
    reviewerName: row.reviewer_name,
    status: normalizeReviewStatus(row.status),
    issueArea: normalizeIssueArea(row.issue_area),
    comment: row.comment,
    createdAt: row.created_at.toISOString(),
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

function normalizeReviewState(value: string | null): ReviewState {
  return value === "open" || value === "resolved" || value === "ignored"
    ? value
    : "unreviewed";
}

function normalizeReviewStatus(value: string): ReviewStatus {
  return value === "resolved" || value === "ignored" ? value : "open";
}

function normalizeIssueArea(value: string | null): ReviewIssueArea | null {
  return value === "prompt" ||
    value === "model" ||
    value === "tool" ||
    value === "retrieval" ||
    value === "data" ||
    value === "infrastructure" ||
    value === "other"
    ? value
    : null;
}

function normalizeFeedbackType(value: string): FeedbackType {
  return value === "thumbs_up" ||
    value === "thumbs_down" ||
    value === "retry" ||
    value === "abandon"
    ? value
    : "comment";
}

function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}

function addExactFilter(
  conditions: string[],
  values: unknown[],
  column: string,
  value: string | undefined,
): void {
  if (value === undefined) {
    return;
  }
  values.push(value);
  conditions.push(`${column} = $${values.length}`);
}
