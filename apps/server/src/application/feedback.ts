import type {
  FeedbackItem,
  FeedbackType,
  FeedbackWriteRequest,
  FeedbackWriteResponse,
} from "@agent-ops/contracts";

export interface FeedbackCreateResult {
  feedback: FeedbackItem;
  created: boolean;
}

export interface FeedbackRepository {
  create(input: NormalizedFeedback): Promise<FeedbackCreateResult>;
}

export interface FeedbackService {
  create(input: FeedbackWriteRequest): Promise<FeedbackWriteResponse>;
}

export interface NormalizedFeedback {
  traceId: string;
  spanId: string | null;
  eventId: string;
  type: FeedbackType;
  actorRef: string | null;
  comment: string | null;
}

export class FeedbackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackValidationError";
  }
}

export class FeedbackConflictError extends Error {
  constructor() {
    super("Feedback eventId was already used with different content");
    this.name = "FeedbackConflictError";
  }
}

export class FeedbackTraceNotFoundError extends Error {
  constructor() {
    super("Trace not found");
    this.name = "FeedbackTraceNotFoundError";
  }
}

const FEEDBACK_TYPES = new Set<FeedbackType>([
  "thumbs_up",
  "thumbs_down",
  "retry",
  "abandon",
  "comment",
]);

export function createFeedbackService(
  repository: FeedbackRepository,
): FeedbackService {
  return {
    async create(input) {
      return repository.create(normalizeFeedback(input));
    },
  };
}

function normalizeFeedback(input: FeedbackWriteRequest): NormalizedFeedback {
  const traceId = requiredText(input.traceId, "traceId", 256);
  const eventId = requiredText(input.eventId, "eventId", 128);
  if (!FEEDBACK_TYPES.has(input.type)) {
    throw new FeedbackValidationError("Invalid feedback type");
  }
  return {
    traceId,
    eventId,
    type: input.type,
    spanId: optionalText(input.spanId, "spanId", 256),
    actorRef: optionalText(input.actorRef, "actorRef", 256),
    comment: optionalText(input.comment, "comment", 2000),
  };
}

function requiredText(value: string, name: string, max: number): string {
  const normalized = value.trim();
  if (normalized === "" || normalized.length > max) {
    throw new FeedbackValidationError(`${name} must be 1-${max} characters`);
  }
  return normalized;
}

function optionalText(
  value: string | undefined,
  name: string,
  max: number,
): string | null {
  if (value === undefined) {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new FeedbackValidationError(`${name} must be at most ${max} characters`);
  }
  return normalized === "" ? null : normalized;
}
