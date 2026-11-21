import type {
  TraceDetail,
  TraceListItem,
  TraceListQuery,
} from "@agent-ops/contracts";

export interface TraceReadRepository {
  list(query: NormalizedTraceListQuery): Promise<TraceListItem[]>;
  get(traceId: string): Promise<TraceDetail | null>;
}

export interface NormalizedTraceListQuery extends TraceListQuery {
  limit: number;
}

export interface TraceQueryService {
  list(query: TraceListQuery): Promise<TraceListItem[]>;
  get(traceId: string): Promise<TraceDetail | null>;
}

export function createTraceQueryService(
  repository: TraceReadRepository,
): TraceQueryService {
  return {
    list(query) {
      return repository.list(normalizeTraceListQuery(query));
    },
    get(traceId) {
      return repository.get(traceId);
    },
  };
}

function normalizeTraceListQuery(
  query: TraceListQuery,
): NormalizedTraceListQuery {
  const requestedLimit = Number(query.limit ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
    : 50;

  return {
    ...(optionalText(query.search) === undefined
      ? {}
      : { search: optionalText(query.search) }),
    ...(optionalFilter(query.status) === undefined
      ? {}
      : { status: optionalFilter(query.status) }),
    ...(optionalFilter(query.environment) === undefined
      ? {}
      : { environment: optionalFilter(query.environment) }),
    limit,
  };
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? undefined : normalized;
}

function optionalFilter(value: string | undefined): string | undefined {
  return value === undefined || value === "all" ? undefined : value;
}
