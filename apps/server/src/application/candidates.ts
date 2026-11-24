import type {
  TraceCandidate,
  TraceCandidateActionResponse,
  TraceCandidateDismissRequest,
  TraceCandidateListResponse,
} from "@agent-ops/contracts";

import type { HumanPrincipal } from "./auth.js";

export interface CandidateRepository {
  list(startedAfter: string): Promise<TraceCandidate[]>;
  dismiss(
    traceId: string,
    principal: HumanPrincipal,
    reason: string | null,
    now: Date,
  ): Promise<boolean>;
  restore(traceId: string): Promise<boolean>;
}

export interface CandidateService {
  list(): Promise<TraceCandidateListResponse>;
  dismiss(
    traceId: string,
    principal: HumanPrincipal,
    input: TraceCandidateDismissRequest,
  ): Promise<TraceCandidateActionResponse>;
  restore(traceId: string): Promise<TraceCandidateActionResponse>;
}

export interface CandidateServiceOptions {
  now?: () => Date;
  windowHours?: number;
}

export class CandidateNotFoundError extends Error {
  constructor() {
    super("Candidate trace not found");
    this.name = "CandidateNotFoundError";
  }
}

export class CandidateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidateValidationError";
  }
}

export function createCandidateService(
  repository: CandidateRepository,
  options: CandidateServiceOptions = {},
): CandidateService {
  const now = options.now ?? (() => new Date());
  const windowHours = options.windowHours ?? 24 * 30;
  return {
    async list() {
      const generatedAt = now();
      const items = await repository.list(isoBefore(generatedAt, windowHours));
      const active = items.filter((item) => item.dismissedAt === null);
      return {
        windowHours,
        generatedAt: generatedAt.toISOString(),
        counts: {
          active: active.length,
          negativeFeedback: active.filter((item) =>
            item.reasons.includes("negative_feedback"),
          ).length,
          reviewOpen: active.filter((item) =>
            item.reasons.includes("review_open"),
          ).length,
          runtimeFailure: active.filter((item) =>
            item.reasons.includes("runtime_failure"),
          ).length,
          evaluationFailed: active.filter((item) =>
            item.reasons.includes("evaluation_failed"),
          ).length,
          evaluationBlocked: active.filter((item) =>
            item.reasons.includes("evaluation_blocked"),
          ).length,
          dismissed: items.length - active.length,
        },
        items,
      };
    },

    async dismiss(traceId, principal, input) {
      const normalizedTraceId = traceId.trim();
      if (normalizedTraceId === "" || normalizedTraceId.length > 256) {
        throw new CandidateValidationError("traceId must be 1-256 characters");
      }
      const reason = optionalText(input?.reason, "reason", 1000);
      const updated = await repository.dismiss(
        normalizedTraceId,
        principal,
        reason,
        now(),
      );
      if (!updated) {
        throw new CandidateNotFoundError();
      }
      return { traceId: normalizedTraceId, dismissed: true };
    },

    async restore(traceId) {
      const normalizedTraceId = traceId.trim();
      if (normalizedTraceId === "" || normalizedTraceId.length > 256) {
        throw new CandidateValidationError("traceId must be 1-256 characters");
      }
      const restored = await repository.restore(normalizedTraceId);
      if (!restored) {
        throw new CandidateNotFoundError();
      }
      return { traceId: normalizedTraceId, dismissed: false };
    },
  };
}

function isoBefore(value: Date, hours: number): string {
  return new Date(value.getTime() - hours * 60 * 60 * 1000).toISOString();
}

function optionalText(
  value: string | undefined,
  name: string,
  maxLength: number,
): string | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "string") {
    throw new CandidateValidationError(`${name} must be text`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new CandidateValidationError(
      `${name} must be at most ${maxLength} characters`,
    );
  }
  return normalized === "" ? null : normalized;
}
