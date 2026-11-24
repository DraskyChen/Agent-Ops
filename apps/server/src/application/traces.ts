import type {
  ReviewState,
  SessionDetail,
  SessionListQuery,
  SessionListResponse,
  SessionSummary,
  SessionStatusCounts,
  TraceDetail,
  TraceListItem,
  TraceListQuery,
  TraceListResponse,
} from "@agent-ops/contracts";

export interface TraceCursor {
  startedAt: string;
  traceId: string;
}

export interface NormalizedTraceListQuery {
  search?: string;
  status?: string;
  environment?: string;
  startedAfter: string;
  startedBefore?: string;
  appName?: string;
  taskType?: string;
  model?: string;
  promptVersion?: string;
  evalCaseId?: string;
  serviceVersion?: string;
  hasErrors?: "true" | "false";
  reviewStatus?: ReviewState;
  cursor?: TraceCursor;
  limit: number;
}

export interface NormalizedSessionListQuery {
  startedAfter: string;
  search?: string;
  limit: number;
}

export interface TraceReadRepository {
  list(query: NormalizedTraceListQuery): Promise<TraceListResponse>;
  listSessions(
    query: NormalizedSessionListQuery,
  ): Promise<SessionSummary[]>;
  listBySession(sessionId: string): Promise<TraceListItem[]>;
  get(traceId: string): Promise<TraceDetail | null>;
}

export interface TraceQueryService {
  list(query: TraceListQuery): Promise<TraceListResponse>;
  listSessions(query: SessionListQuery): Promise<SessionListResponse>;
  getSession(sessionId: string): Promise<SessionDetail | null>;
  get(traceId: string): Promise<TraceDetail | null>;
}

export interface TraceQueryServiceOptions {
  now?: () => Date;
}

export class InvalidTraceQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTraceQueryError";
  }
}

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const REVIEW_STATES = new Set<ReviewState>([
  "unreviewed",
  "open",
  "resolved",
  "ignored",
]);

export function createTraceQueryService(
  repository: TraceReadRepository,
  options: TraceQueryServiceOptions = {},
): TraceQueryService {
  const now = options.now ?? (() => new Date());
  return {
    list(query) {
      return repository.list(normalizeTraceListQuery(query, now()));
    },
    async listSessions(query) {
      const generatedAt = now();
      const normalized = normalizeSessionListQuery(query, generatedAt);
      const items = await repository.listSessions(normalized);
      return {
        windowHours: Math.max(
          1,
          Math.ceil(
            (generatedAt.getTime() -
              new Date(normalized.startedAfter).getTime()) /
              (60 * 60 * 1000),
          ),
        ),
        generatedAt: generatedAt.toISOString(),
        items,
      };
    },
    async getSession(sessionId) {
      const normalized = sessionId.trim();
      if (normalized === "" || normalized.length > 256) {
        throw new InvalidTraceQueryError(
          "sessionId must be 1-256 characters",
        );
      }
      const runs = await repository.listBySession(normalized);
      return runs.length === 0
        ? null
        : sessionDetail(normalized, runs);
    },
    get(traceId) {
      return repository.get(traceId);
    },
  };
}

export function normalizeSessionListQuery(
  query: SessionListQuery,
  now: Date,
): NormalizedSessionListQuery {
  const requestedLimit = Number(query.limit ?? 100);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
    : 100;
  const search = optionalText(query.search);
  if (search !== undefined && search.length > 256) {
    throw new InvalidTraceQueryError(
      "session search must be at most 256 characters",
    );
  }
  return {
    startedAfter:
      parseDate(query.startedAfter, "startedAfter") ??
      new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    ...optionalEntry("search", search),
    limit,
  };
}

function sessionDetail(
  sessionId: string,
  runs: TraceListItem[],
): SessionDetail {
  const statusCounts: SessionStatusCounts = {
    unknown: 0,
    success: 0,
    failed: 0,
    partial: 0,
    cancelled: 0,
    timeout: 0,
  };
  let firstStartedAt: number | null = null;
  let lastEndedAt: number | null = null;
  let totalCostMicros = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let toolErrorCount = 0;

  for (const run of runs) {
    if (run.runStatus === null) {
      statusCounts.unknown += 1;
    } else {
      statusCounts[run.runStatus] += 1;
    }
    totalCostMicros += run.costMicros ?? 0;
    inputTokens += run.inputTokens ?? 0;
    outputTokens += run.outputTokens ?? 0;
    toolErrorCount += run.toolErrorCount ?? 0;
    if (run.startedAt !== null) {
      const startedAt = new Date(run.startedAt).getTime();
      const endedAt = startedAt + (run.latencyMs ?? 0);
      firstStartedAt =
        firstStartedAt === null ? startedAt : Math.min(firstStartedAt, startedAt);
      lastEndedAt =
        lastEndedAt === null ? endedAt : Math.max(lastEndedAt, endedAt);
    }
  }

  return {
    sessionId,
    traceCount: runs.length,
    firstStartedAt:
      firstStartedAt === null ? null : new Date(firstStartedAt).toISOString(),
    lastEndedAt:
      lastEndedAt === null ? null : new Date(lastEndedAt).toISOString(),
    durationMs:
      firstStartedAt === null || lastEndedAt === null
        ? null
        : Math.max(0, lastEndedAt - firstStartedAt),
    totalCostMicros,
    inputTokens,
    outputTokens,
    toolErrorCount,
    statusCounts,
    appNames: [
      ...new Set(
        runs
          .map((run) => run.appName)
          .filter((name): name is string => name !== null),
      ),
    ].sort(),
    runs,
  };
}

export function normalizeTraceListQuery(
  query: TraceListQuery,
  now: Date,
): NormalizedTraceListQuery {
  const requestedLimit = Number(query.limit ?? 50);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(Math.trunc(requestedLimit), 1), 200)
    : 50;
  const startedAfter =
    parseDate(query.startedAfter, "startedAfter") ??
    new Date(now.getTime() - DEFAULT_WINDOW_MS).toISOString();
  const startedBefore = parseDate(query.startedBefore, "startedBefore");
  if (
    startedBefore !== undefined &&
    new Date(startedBefore) < new Date(startedAfter)
  ) {
    throw new InvalidTraceQueryError(
      "startedBefore must be later than startedAfter",
    );
  }

  const reviewStatus = optionalText(query.reviewStatus);
  if (
    reviewStatus !== undefined &&
    !REVIEW_STATES.has(reviewStatus as ReviewState)
  ) {
    throw new InvalidTraceQueryError("Invalid reviewStatus");
  }

  return {
    ...optionalEntry("search", optionalText(query.search)),
    ...optionalEntry("status", optionalFilter(query.status)),
    ...optionalEntry("environment", optionalFilter(query.environment)),
    startedAfter,
    ...optionalEntry("startedBefore", startedBefore),
    ...optionalEntry("appName", optionalText(query.appName)),
    ...optionalEntry("taskType", optionalFilter(query.taskType)),
    ...optionalEntry("model", optionalText(query.model)),
    ...optionalEntry("promptVersion", optionalText(query.promptVersion)),
    ...optionalEntry("evalCaseId", optionalText(query.evalCaseId)),
    ...optionalEntry("serviceVersion", optionalText(query.serviceVersion)),
    ...optionalEntry(
      "hasErrors",
      query.hasErrors === "true" || query.hasErrors === "false"
        ? query.hasErrors
        : undefined,
    ),
    ...optionalEntry(
      "reviewStatus",
      reviewStatus as ReviewState | undefined,
    ),
    ...optionalEntry(
      "cursor",
      query.cursor === undefined ? undefined : decodeTraceCursor(query.cursor),
    ),
    limit,
  };
}

export function encodeTraceCursor(cursor: TraceCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeTraceCursor(value: string): TraceCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("startedAt" in parsed) ||
      !("traceId" in parsed) ||
      typeof parsed.startedAt !== "string" ||
      typeof parsed.traceId !== "string" ||
      Number.isNaN(new Date(parsed.startedAt).getTime()) ||
      parsed.traceId === ""
    ) {
      throw new Error("invalid cursor shape");
    }
    return {
      startedAt: new Date(parsed.startedAt).toISOString(),
      traceId: parsed.traceId,
    };
  } catch {
    throw new InvalidTraceQueryError("Invalid trace cursor");
  }
}

function parseDate(
  value: string | undefined,
  field: string,
): string | undefined {
  const normalized = optionalText(value);
  if (normalized === undefined) {
    return undefined;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidTraceQueryError(`${field} must be an ISO timestamp`);
  }
  return parsed.toISOString();
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized === "" ? undefined : normalized;
}

function optionalFilter(value: string | undefined): string | undefined {
  return value === undefined || value === "" || value === "all"
    ? undefined
    : value;
}

function optionalEntry<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}
