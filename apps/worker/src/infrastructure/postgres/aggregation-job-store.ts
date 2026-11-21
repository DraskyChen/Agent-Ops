import type { Pool, PoolClient } from "pg";

import type {
  AggregationJobStore,
  AggregationTransaction,
} from "../../application/aggregate-trace-job.js";
import type {
  AggregatedTrace,
  StoredTraceSpan,
} from "../../domain/trace-aggregation.js";
import { calculateCostMicros, pricingTier } from "../../pricing.js";

export function createPostgresAggregationJobStore(
  pool: Pool,
): AggregationJobStore {
  return {
    async transaction(work) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const transaction = createTransaction(client);
        const result = await work(transaction);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    },

    async markFailed(traceId, error) {
      await pool.query(
        `update trace_aggregation_jobs set
          attempt_count = attempt_count + 1,
          state = case
            when attempt_count + 1 >= 5 then 'failed'
            else 'pending'
          end,
          last_error = $2,
          completed_at = case
            when attempt_count + 1 >= 5 then now()
            else null
          end
        where trace_id = $1`,
        [traceId, error.message],
      );
    },
  };
}

function createTransaction(client: PoolClient): AggregationTransaction {
  return {
    async claimNextTraceId() {
      const result = await client.query<{ trace_id: string }>(
        `select trace_id
         from trace_aggregation_jobs
         where state = 'pending' and not_before <= now()
         order by requested_at
         for update skip locked
         limit 1`,
      );
      const traceId = result.rows[0]?.trace_id ?? null;
      if (traceId === null) {
        return null;
      }

      await client.query(
        `update trace_aggregation_jobs set
          state = 'processing',
          started_at = now(),
          attempt_count = attempt_count + 1
        where trace_id = $1`,
        [traceId],
      );
      return traceId;
    },

    async loadSpans(traceId): Promise<StoredTraceSpan[]> {
      const result = await client.query<StoredTraceSpan>(
        `select
          trace_id, span_id, parent_span_id, service_name, service_version,
          environment, span_type, name, start_time, end_time, duration_ms,
          status, resource_attributes, attributes, input_tokens, output_tokens,
          cached_input_tokens, cost_micros
        from spans
        where trace_id = $1
        order by start_time asc, span_id asc`,
        [traceId],
      );
      return result.rows;
    },

    async priceSpans(spans) {
      await priceSpans(client, spans);
    },

    async saveTrace(trace) {
      await client.query(
        `insert into traces (
          trace_id, session_id, root_span_id, app_name, run_name, service_name,
          service_version, environment, task_type, prompt_version, model,
          run_status, stop_reason, first_span_at, last_span_at, start_time,
          end_time, root_ended_at, duration_ms, step_count, llm_call_count,
          tool_call_count, tool_error_count, input_tokens, output_tokens,
          cost_micros, currency, completeness, ingest_state, sealed_at,
          aggregation_revision
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28,
          $29, $30, 1
        )
        on conflict (trace_id) do update set
          session_id = excluded.session_id,
          root_span_id = excluded.root_span_id,
          app_name = excluded.app_name,
          run_name = excluded.run_name,
          service_name = excluded.service_name,
          service_version = excluded.service_version,
          environment = excluded.environment,
          task_type = excluded.task_type,
          prompt_version = excluded.prompt_version,
          model = excluded.model,
          run_status = excluded.run_status,
          stop_reason = excluded.stop_reason,
          first_span_at = excluded.first_span_at,
          last_span_at = excluded.last_span_at,
          start_time = excluded.start_time,
          end_time = excluded.end_time,
          root_ended_at = excluded.root_ended_at,
          duration_ms = excluded.duration_ms,
          step_count = excluded.step_count,
          llm_call_count = excluded.llm_call_count,
          tool_call_count = excluded.tool_call_count,
          tool_error_count = excluded.tool_error_count,
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          cost_micros = excluded.cost_micros,
          currency = excluded.currency,
          completeness = excluded.completeness,
          ingest_state = excluded.ingest_state,
          sealed_at = excluded.sealed_at,
          aggregation_revision = traces.aggregation_revision + 1`,
        traceValues(trace),
      );
    },

    async schedule(traceId, notBefore) {
      await client.query(
        `update trace_aggregation_jobs set
          state = 'pending',
          requested_at = least(requested_at, $2),
          not_before = $2,
          completed_at = null
        where trace_id = $1`,
        [traceId, notBefore],
      );
    },

    async complete(traceId) {
      await client.query(
        `update trace_aggregation_jobs set
          state = 'completed',
          completed_at = now(),
          last_error = null
        where trace_id = $1`,
        [traceId],
      );
    },
  };
}

interface PriceRow {
  id: string;
  input_micros_per_million_tokens: string;
  output_micros_per_million_tokens: string;
  cached_input_micros_per_million_tokens: string | null;
}

async function priceSpans(
  client: PoolClient,
  spans: StoredTraceSpan[],
): Promise<void> {
  for (const span of spans.filter(
    (candidate) => candidate.span_type === "llm.call",
  )) {
    const provider = stringValue(span.attributes["gen_ai.provider.name"]);
    const model = stringValue(span.attributes["gen_ai.request.model"]);
    if (provider === null || model === null) {
      continue;
    }

    const tier = pricingTier(provider, span.start_time);
    const result = await client.query<PriceRow>(
      `select
        id,
        input_micros_per_million_tokens,
        output_micros_per_million_tokens,
        cached_input_micros_per_million_tokens
      from price_versions
      where lower(provider) = lower($1)
        and model_pattern = $2
        and pricing_tier = $3
        and currency = 'USD'
        and effective_from <= $4
        and (effective_to is null or effective_to > $4)
      order by effective_from desc
      limit 1`,
      [provider, model, tier, span.start_time],
    );
    const price = result.rows[0];
    if (price === undefined) {
      continue;
    }

    const costMicros = calculateCostMicros({
      inputTokens: numberValue(span.input_tokens),
      cachedInputTokens: numberValue(span.cached_input_tokens),
      outputTokens: numberValue(span.output_tokens),
      price: {
        inputMicrosPerMillionTokens: BigInt(
          price.input_micros_per_million_tokens,
        ),
        outputMicrosPerMillionTokens: BigInt(
          price.output_micros_per_million_tokens,
        ),
        cachedInputMicrosPerMillionTokens: BigInt(
          price.cached_input_micros_per_million_tokens ??
            price.input_micros_per_million_tokens,
        ),
      },
    });
    await client.query(
      `update spans set
        cost_micros = $3,
        price_version_id = $4
      where trace_id = $1 and span_id = $2`,
      [
        span.trace_id,
        span.span_id,
        costMicros.toString(),
        price.id,
      ],
    );
    span.cost_micros = costMicros.toString();
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function numberValue(value: string | null): number {
  return value === null ? 0 : Number(value);
}

function traceValues(trace: AggregatedTrace): unknown[] {
  return [
    trace.traceId,
    trace.sessionId,
    trace.rootSpanId,
    trace.appName,
    trace.runName,
    trace.serviceName,
    trace.serviceVersion,
    trace.environment,
    trace.taskType,
    trace.promptVersion,
    trace.model,
    trace.runStatus,
    trace.stopReason,
    trace.firstSpanAt,
    trace.lastSpanAt,
    trace.startTime,
    trace.endTime,
    trace.rootEndedAt,
    trace.durationMs,
    trace.stepCount,
    trace.llmCallCount,
    trace.toolCallCount,
    trace.toolErrorCount,
    trace.inputTokens,
    trace.outputTokens,
    trace.costMicros,
    "USD",
    trace.completeness,
    trace.ingestState,
    trace.sealedAt,
  ];
}
