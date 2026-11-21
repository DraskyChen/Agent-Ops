import type { IngestHealthResponse } from "@agent-ops/contracts";
import type { Pool } from "pg";

import type { OperationsRepository } from "../../application/operations.js";

export function createPostgresOperationsRepository(
  pool: Pool,
): OperationsRepository {
  return {
    async ingestHealth(windowHours): Promise<IngestHealthResponse> {
      const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
      const [batches, rejects, aggregation, content] = await Promise.all([
        pool.query<BatchSummaryRow>(
          `select
            count(*)::int as total,
            count(*) filter (where status = 'accepted')::int as accepted,
            count(*) filter (where status = 'partial')::int as partial,
            count(*) filter (
              where status = 'failed'
                or (status = 'processing' and received_at < now() - interval '10 minutes')
            )::int as failed,
            coalesce(sum(accepted_count), 0)::bigint as accepted_spans,
            coalesce(sum(rejected_count), 0)::bigint as rejected_spans
          from ingest_batches
          where received_at >= $1`,
          [since],
        ),
        pool.query<ReasonCountRow>(
          `select reason, count(*)::int as count
           from ingest_rejects
           where created_at >= $1
           group by reason
           order by count desc, reason asc
           limit 20`,
          [since],
        ),
        pool.query<AggregationRow>(
          `select
            count(*) filter (where state = 'pending')::int as pending,
            count(*) filter (where state = 'processing')::int as processing,
            count(*) filter (where state = 'failed')::int as failed,
            min(requested_at) filter (where state = 'pending') as oldest_pending_at
           from trace_aggregation_jobs`,
        ),
        pool.query<ContentSummaryRow>(
          `select
            count(*) filter (where status = 'available')::int as available,
            count(*) filter (where status = 'expired')::int as expired,
            count(*) filter (
              where status not in ('available', 'expired')
            )::int as unavailable
           from content_objects`,
        ),
      ]);

      const batch = batches.rows[0];
      const aggregate = aggregation.rows[0];
      const objects = content.rows[0];
      return {
        windowHours,
        generatedAt: new Date().toISOString(),
        batches: {
          total: batch?.total ?? 0,
          accepted: batch?.accepted ?? 0,
          partial: batch?.partial ?? 0,
          failed: batch?.failed ?? 0,
          acceptedSpans: Number(batch?.accepted_spans ?? 0),
          rejectedSpans: Number(batch?.rejected_spans ?? 0),
        },
        rejectsByReason: rejects.rows.map((row) => ({
          reason: row.reason,
          count: row.count,
        })),
        aggregation: {
          pending: aggregate?.pending ?? 0,
          processing: aggregate?.processing ?? 0,
          failed: aggregate?.failed ?? 0,
          oldestPendingAt:
            aggregate?.oldest_pending_at?.toISOString() ?? null,
        },
        content: {
          available: objects?.available ?? 0,
          unavailable: objects?.unavailable ?? 0,
          expired: objects?.expired ?? 0,
        },
      };
    },
  };
}

interface BatchSummaryRow {
  total: number;
  accepted: number;
  partial: number;
  failed: number;
  accepted_spans: string;
  rejected_spans: string;
}

interface ReasonCountRow {
  reason: string;
  count: number;
}

interface AggregationRow {
  pending: number;
  processing: number;
  failed: number;
  oldest_pending_at: Date | null;
}

interface ContentSummaryRow {
  available: number;
  unavailable: number;
  expired: number;
}
