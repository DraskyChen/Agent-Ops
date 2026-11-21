import { createHash, randomUUID } from "node:crypto";

import type { Pool } from "pg";

import {
  isSpanBeyondLateness,
  type IngestBatchWrite,
} from "../../application/ingest.js";
import { durationMilliseconds, unixNanoToDate } from "../otlp/time.js";

export interface PersistBatchResult {
  batchId: string;
  acceptedCount: number;
  rejectedCount: number;
  ownerApp: string;
}

export interface PersistBatchOptions {
  maxLatenessHours: number;
}

export async function persistBatch(
  pool: Pool,
  input: IngestBatchWrite,
  options: PersistBatchOptions,
): Promise<PersistBatchResult> {
  const client = await pool.connect();
  const batchId = randomUUID();
  const ownerApp =
    input.spans
      .map((span) => stringValue(span.resourceAttributes["agent.app.name"]))
      .find((value) => value !== undefined) ?? "unknown";
  const payloadDigest = createHash("sha256")
    .update(input.payload)
    .digest("hex");
  const receivedNow = Date.now();

  try {
    await client.query("begin");
    await client.query(
      `insert into ingest_batches (
        batch_id, owner_app, received_at, request_bytes, payload_digest,
        span_count, accepted_count, rejected_count, status
      ) values ($1, $2, now(), $3, $4, $5, 0, 0, 'processing')`,
      [
        batchId,
        ownerApp,
        input.payload.byteLength,
        payloadDigest,
        input.spans.length + input.rejected.length,
      ],
    );

    let acceptedCount = 0;
    let conflictCount = 0;
    let lateCount = 0;
    const traceIds = new Set<string>();
    for (const span of input.spans) {
      const startTime = unixNanoToDate(span.startTimeUnixNano);
      const endTime = unixNanoToDate(span.endTimeUnixNano);
      const durationMs = durationMilliseconds(
        span.startTimeUnixNano,
        span.endTimeUnixNano,
      );
      const attributes = span.attributes;

      if (
        isSpanBeyondLateness(
          endTime,
          new Date(receivedNow),
          options.maxLatenessHours,
        )
      ) {
        lateCount += 1;
        await client.query(
          `insert into ingest_rejects (
            batch_id, trace_id, span_id, reason
          ) values ($1, $2, $3, $4)`,
          [
            batchId,
            span.traceId,
            span.spanId,
            `span exceeded maximum lateness of ${options.maxLatenessHours} hour(s)`,
          ],
        );
        continue;
      }

      const inserted = await client.query<{ trace_id: string }>(
        `insert into spans (
          trace_id, span_id, parent_span_id, ingest_batch_id,
          service_name, service_version, environment, span_type, span_subtype,
          name, start_time, end_time, duration_ms, status, error_type,
          error_category, resource_attributes, attributes, input_tokens,
          output_tokens, cached_input_tokens, reasoning_tokens, ttft_ms,
          cost_micros, input_content_ref, output_content_ref, content_recorded,
          schema_version, received_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
          $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26,
          $27, $28, $29
        )
        on conflict (trace_id, span_id) do nothing
        returning trace_id`,
        [
          span.traceId,
          span.spanId,
          span.parentSpanId ?? null,
          batchId,
          span.serviceName ?? null,
          span.serviceVersion ?? null,
          span.environment ?? null,
          span.spanType,
          span.spanSubtype ?? null,
          span.name,
          startTime,
          endTime,
          durationMs,
          span.status,
          span.errorType ?? null,
          span.errorCategory ?? null,
          span.resourceAttributes,
          attributes,
          span.inputTokens ?? null,
          span.outputTokens ?? null,
          span.cachedInputTokens ?? null,
          span.reasoningTokens ?? null,
          span.ttftMs ?? null,
          span.costMicros ?? null,
          span.inputContentId ?? null,
          span.outputContentId ?? null,
          span.contentRecorded,
          span.schemaVersion,
          new Date(span.receivedAt),
        ],
      );

      if ((inserted.rowCount ?? 0) === 0) {
        conflictCount += 1;
        await client.query(
          `insert into ingest_rejects (
            batch_id, trace_id, span_id, reason
          ) values ($1, $2, $3, $4)`,
          [
            batchId,
            span.traceId,
            span.spanId,
            "conflicting duplicate span rejected (first-write-wins)",
          ],
        );
        continue;
      }

      acceptedCount += 1;
      traceIds.add(span.traceId);

      for (const event of span.events) {
        await client.query(
          `insert into span_events (
            trace_id, span_id, event_index, name, event_time, attributes
          ) values ($1, $2, $3, $4, $5, $6)
          on conflict (trace_id, span_id, event_index) do nothing`,
          [
            span.traceId,
            span.spanId,
            event.index,
            event.name,
            unixNanoToDate(event.eventTimeUnixNano),
            event.attributes,
          ],
        );
      }

      if (span.spanType === "agent.run") {
        const sessionId = stringValue(attributes["agent.session.id"]);
        const userId = stringValue(attributes["agent.user.id"]);
        if (sessionId !== undefined) {
          await client.query(
            `insert into sessions (
              session_id, first_seen_at, last_seen_at, redacted_user_id
            ) values ($1, $2, $2, $3)
            on conflict (session_id) do update set
              first_seen_at = least(sessions.first_seen_at, excluded.first_seen_at),
              last_seen_at = greatest(sessions.last_seen_at, excluded.last_seen_at),
              redacted_user_id = coalesce(
                excluded.redacted_user_id,
                sessions.redacted_user_id
              )`,
            [sessionId, startTime, userId ?? null],
          );
        }
      }
    }

    for (const traceId of traceIds) {
      await client.query(
        `insert into trace_aggregation_jobs (
          trace_id, state, requested_at, not_before
        ) values ($1, 'pending', now(), now())
        on conflict (trace_id) do update set
          state = 'pending',
          requested_at = now(),
          not_before = now(),
          completed_at = null,
          attempt_count = 0,
          last_error = null`,
        [traceId],
      );
    }

    const rejectedCount = input.rejected.length + conflictCount + lateCount;
    for (const rejected of input.rejected) {
      await client.query(
        `insert into ingest_rejects (
          batch_id, trace_id, span_id, reason
        ) values ($1, $2, $3, $4)`,
        [
          batchId,
          rejected.traceId ?? null,
          rejected.spanId ?? null,
          rejected.reason,
        ],
      );
    }

    await client.query(
      `update ingest_batches set
        accepted_count = $2,
        rejected_count = $3,
        status = $4
      where batch_id = $1`,
      [
        batchId,
        acceptedCount,
        rejectedCount,
        rejectedCount === 0 ? "accepted" : "partial",
      ],
    );
    await client.query("commit");

    return {
      batchId,
      acceptedCount,
      rejectedCount,
      ownerApp,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

