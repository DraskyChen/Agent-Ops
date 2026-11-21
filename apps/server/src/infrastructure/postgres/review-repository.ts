import type {
  ReviewIssueArea,
  ReviewItem,
  ReviewStatus,
} from "@agent-ops/contracts";
import type { Pool } from "pg";

import type { HumanPrincipal } from "../../application/auth.js";
import {
  ReviewTraceNotFoundError,
  type NormalizedReview,
  type ReviewRepository,
} from "../../application/reviews.js";

export function createPostgresReviewRepository(
  pool: Pool,
): ReviewRepository {
  return {
    async create(traceId, principal: HumanPrincipal, input: NormalizedReview) {
      const result = await pool.query<ReviewRow>(
        `insert into trace_reviews (
          trace_id, reviewer_subject, reviewer_name, status, issue_area, comment
        )
        select $1, $2, $3, $4, $5, $6
        where exists (select 1 from traces where trace_id = $1)
        returning
          id, trace_id, reviewer_subject, reviewer_name, status, issue_area,
          comment, created_at`,
        [
          traceId,
          principal.subject,
          principal.displayName,
          input.status,
          input.issueArea,
          input.comment,
        ],
      );
      const row = result.rows[0];
      if (row === undefined) {
        throw new ReviewTraceNotFoundError();
      }
      return mapReview(row);
    },
  };
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

function mapReview(row: ReviewRow): ReviewItem {
  return {
    reviewId: row.id,
    traceId: row.trace_id,
    reviewerSubject: row.reviewer_subject,
    reviewerName: row.reviewer_name,
    status: normalizeStatus(row.status),
    issueArea: normalizeIssueArea(row.issue_area),
    comment: row.comment,
    createdAt: row.created_at.toISOString(),
  };
}

function normalizeStatus(value: string): ReviewStatus {
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
