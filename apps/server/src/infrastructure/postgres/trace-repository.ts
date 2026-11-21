import {
  isRunStatus,
  isTraceIngestState,
  normalizeSpanType,
  normalizeTaskType,
  type Environment,
  type TraceDetail,
  type TraceListItem,
  type TraceSpan,
} from "@agent-ops/contracts";
import type { Pool } from "pg";

import type {
  NormalizedTraceListQuery,
  TraceReadRepository,
} from "../../application/traces.js";

export function createPostgresTraceReadRepository(
  pool: Pool,
): TraceReadRepository {
  return {
    async list(query) {
      const conditions: string[] = ["start_time is not null"];
      const values: unknown[] = [];

      if (query.status !== undefined) {
        values.push(query.status);
        conditions.push(`run_status = $${values.length}`);
      }
      if (query.environment !== undefined) {
        values.push(query.environment);
        conditions.push(`environment = $${values.length}`);
      }
      if (query.search !== undefined) {
        values.push(`%${query.search}%`);
        const index = values.length;
        conditions.push(`(
          run_name ilike $${index}
          or trace_id ilike $${index}
          or task_type ilike $${index}
          or model ilike $${index}
          or session_id ilike $${index}
        )`);
      }

      values.push(query.limit);
      const result = await pool.query<TraceRow>(
        `select
          trace_id, run_name, session_id, task_type, model, environment,
          run_status, duration_ms, cost_micros, input_tokens, output_tokens,
          step_count, start_time, ingest_state
        from traces
        where ${conditions.join(" and ")}
        order by start_time desc, trace_id
        limit $${values.length}`,
        values,
      );

      return result.rows.map(mapTraceListItem);
    },

    async get(traceId) {
      const traceResult = await pool.query<TraceRow>(
        `select
          trace_id, run_name, session_id, task_type, model, environment,
          run_status, duration_ms, cost_micros, input_tokens, output_tokens,
          step_count, start_time, ingest_state, prompt_version, stop_reason
        from traces
        where trace_id = $1`,
        [traceId],
      );
      const trace = traceResult.rows[0];
      if (trace === undefined) {
        return null;
      }

      const spans = await pool.query<SpanRow>(
        `select
          span_id, parent_span_id, name, span_type, span_subtype, service_name,
          start_time, end_time, duration_ms, status, error_type, error_category,
          attributes, resource_attributes, input_tokens, output_tokens,
          cost_micros, input_content_ref, output_content_ref
        from spans
        where trace_id = $1
        order by start_time asc, span_id asc`,
        [traceId],
      );

      return {
        ...mapTraceListItem(trace),
        promptVersion: trace.prompt_version,
        stopReason: trace.stop_reason,
        spans: spans.rows.map(mapTraceSpan),
      };
    },
  };
}

interface TraceRow {
  trace_id: string;
  run_name: string | null;
  session_id: string | null;
  task_type: string | null;
  model: string | null;
  environment: string | null;
  run_status: string | null;
  duration_ms: string | null;
  cost_micros: string | null;
  input_tokens: string | null;
  output_tokens: string | null;
  step_count: number | null;
  start_time: Date | null;
  ingest_state: string;
  prompt_version: string | null;
  stop_reason: string | null;
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

function mapTraceListItem(row: TraceRow): TraceListItem {
  return {
    traceId: row.trace_id,
    runName: row.run_name ?? "Untitled agent run",
    sessionId: row.session_id,
    taskType:
      row.task_type === null ? null : normalizeTaskType(row.task_type),
    model: row.model,
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
    startedAt: row.start_time?.toISOString() ?? null,
    ingestState: isTraceIngestState(row.ingest_state)
      ? row.ingest_state
      : "open",
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

function normalizeEnvironment(value: string | null): Environment | null {
  return value === "prod" ||
    value === "staging" ||
    value === "dev" ||
    value === "test"
    ? value
    : null;
}

function numberOrNull(value: string | null): number | null {
  return value === null ? null : Number(value);
}
