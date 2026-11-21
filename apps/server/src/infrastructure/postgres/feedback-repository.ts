import type {
  FeedbackItem,
  FeedbackType,
} from "@agent-ops/contracts";
import type { Pool } from "pg";

import {
  FeedbackConflictError,
  FeedbackTraceNotFoundError,
  type FeedbackCreateResult,
  type FeedbackRepository,
  type NormalizedFeedback,
} from "../../application/feedback.js";

export function createPostgresFeedbackRepository(
  pool: Pool,
): FeedbackRepository {
  return {
    async create(input) {
      const exists = await pool.query(
        "select 1 from traces where trace_id = $1",
        [input.traceId],
      );
      if (exists.rowCount === 0) {
        throw new FeedbackTraceNotFoundError();
      }

      const inserted = await pool.query<FeedbackRow>(
        `insert into feedback (
          trace_id, span_id, event_id, type, actor_ref, comment
        ) values ($1, $2, $3, $4, $5, $6)
        on conflict (trace_id, event_id) where event_id is not null do nothing
        returning
          id, trace_id, span_id, event_id, type, actor_ref, comment, created_at`,
        [
          input.traceId,
          input.spanId,
          input.eventId,
          input.type,
          input.actorRef,
          input.comment,
        ],
      );
      const created = inserted.rows[0];
      if (created !== undefined) {
        return { feedback: mapFeedback(created), created: true };
      }

      const existing = await pool.query<FeedbackRow>(
        `select
          id, trace_id, span_id, event_id, type, actor_ref, comment, created_at
        from feedback
        where trace_id = $1 and event_id = $2`,
        [input.traceId, input.eventId],
      );
      const row = existing.rows[0];
      if (row === undefined || !sameFeedback(row, input)) {
        throw new FeedbackConflictError();
      }
      return { feedback: mapFeedback(row), created: false };
    },
  };
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

function sameFeedback(row: FeedbackRow, input: NormalizedFeedback): boolean {
  return (
    (row.span_id ?? null) === input.spanId &&
    row.type === input.type &&
    (row.actor_ref ?? null) === input.actorRef &&
    (row.comment ?? null) === input.comment
  );
}

function normalizeFeedbackType(value: string): FeedbackType {
  return value === "thumbs_up" ||
    value === "thumbs_down" ||
    value === "retry" ||
    value === "abandon"
    ? value
    : "comment";
}
