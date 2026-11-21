import type {
  ReviewIssueArea,
  ReviewItem,
  ReviewStatus,
  ReviewWriteRequest,
} from "@agent-ops/contracts";

import type { HumanPrincipal } from "./auth.js";

export interface ReviewRepository {
  create(
    traceId: string,
    principal: HumanPrincipal,
    input: NormalizedReview,
  ): Promise<ReviewItem>;
}

export interface ReviewService {
  create(
    traceId: string,
    principal: HumanPrincipal,
    input: ReviewWriteRequest,
  ): Promise<ReviewItem>;
}

export interface NormalizedReview {
  status: ReviewStatus;
  issueArea: ReviewIssueArea | null;
  comment: string | null;
}

export class ReviewValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewValidationError";
  }
}

export class ReviewTraceNotFoundError extends Error {
  constructor() {
    super("Trace not found");
    this.name = "ReviewTraceNotFoundError";
  }
}

const REVIEW_STATUSES = new Set<ReviewStatus>([
  "open",
  "resolved",
  "ignored",
]);
const ISSUE_AREAS = new Set<ReviewIssueArea>([
  "prompt",
  "model",
  "tool",
  "retrieval",
  "data",
  "infrastructure",
  "other",
]);

export function createReviewService(
  repository: ReviewRepository,
): ReviewService {
  return {
    async create(traceId, principal, input) {
      const normalizedTraceId = traceId.trim();
      if (normalizedTraceId === "" || normalizedTraceId.length > 256) {
        throw new ReviewValidationError("Invalid traceId");
      }
      if (!REVIEW_STATUSES.has(input.status)) {
        throw new ReviewValidationError("Invalid review status");
      }
      if (input.issueArea !== undefined && !ISSUE_AREAS.has(input.issueArea)) {
        throw new ReviewValidationError("Invalid issueArea");
      }
      const comment = input.comment?.trim() ?? "";
      if (comment.length > 4000) {
        throw new ReviewValidationError(
          "comment must be at most 4000 characters",
        );
      }
      return repository.create(normalizedTraceId, principal, {
        status: input.status,
        issueArea: input.issueArea ?? null,
        comment: comment === "" ? null : comment,
      });
    },
  };
}
