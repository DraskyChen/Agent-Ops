import type {
  Environment,
  EvaluationCreateRequest,
  EvaluationDetail,
  EvaluationSummary,
  EvaluationTraceSelector,
  EvaluatorDefinition,
  LlmJudgeDefinition,
} from "@agent-ops/contracts";

import type { HumanPrincipal } from "./auth.js";

export interface NormalizedEvaluationTraceSelector {
  appName?: string;
  promptVersion?: string;
  serviceVersion?: string;
  environment?: Environment;
  startedAfter: string;
  startedBefore: string;
}

export interface NormalizedEvaluationCreate {
  datasetRevisionId: string;
  evaluator: EvaluatorDefinition;
  traceSelector: NormalizedEvaluationTraceSelector;
}

export interface EvaluationRepository {
  list(): Promise<EvaluationSummary[]>;
  get(evaluationId: string): Promise<EvaluationDetail | null>;
  create(
    principal: HumanPrincipal,
    input: NormalizedEvaluationCreate,
  ): Promise<EvaluationDetail>;
  cancel(evaluationId: string): Promise<EvaluationDetail | null>;
}

export interface EvaluationService {
  list(): Promise<EvaluationSummary[]>;
  get(evaluationId: string): Promise<EvaluationDetail | null>;
  create(
    principal: HumanPrincipal,
    input: EvaluationCreateRequest,
  ): Promise<EvaluationDetail>;
  cancel(evaluationId: string): Promise<EvaluationDetail | null>;
}

export interface EvaluationServiceOptions {
  now?: () => Date;
  judgeEnabled?: boolean;
}

export class EvaluationValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationValidationError";
  }
}

export class EvaluationNotFoundError extends Error {
  constructor() {
    super("Evaluation not found");
    this.name = "EvaluationNotFoundError";
  }
}

export class EvaluationCaseAmbiguousError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationCaseAmbiguousError";
  }
}

export class EvaluationPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationPermissionError";
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVALUATOR_KINDS = new Set<EvaluatorDefinition["kind"]>([
  "exact",
  "contains",
  "regex",
  "json_valid",
  "max_latency_ms",
  "max_cost_micros",
  "max_tool_errors",
  "llm_judge",
]);
const ENVIRONMENTS = new Set<Environment>(["prod", "staging", "dev", "test"]);

export function createEvaluationService(
  repository: EvaluationRepository,
  options: EvaluationServiceOptions = {},
): EvaluationService {
  const now = options.now ?? (() => new Date());
  const judgeEnabled = options.judgeEnabled ?? false;
  return {
    list() {
      return repository.list();
    },

    get(evaluationId) {
      if (!UUID_PATTERN.test(evaluationId)) {
        return Promise.resolve(null);
      }
      return repository.get(evaluationId);
    },

    create(principal, input) {
      if (typeof input !== "object" || input === null) {
        throw new EvaluationValidationError("Request body must be an object");
      }
      if (input.evaluator?.kind === "llm_judge") {
        if (!judgeEnabled) {
          throw new EvaluationValidationError(
            "LLM Judge is disabled for this deployment",
          );
        }
        if (principal.role !== "admin") {
          throw new EvaluationPermissionError(
            "Administrator access is required for LLM Judge",
          );
        }
      }
      return repository.create(
        principal,
        normalizeEvaluationCreate(input, now()),
      );
    },

    cancel(evaluationId) {
      if (!UUID_PATTERN.test(evaluationId)) {
        return Promise.resolve(null);
      }
      return repository.cancel(evaluationId);
    },
  };
}

export function normalizeEvaluationCreate(
  input: EvaluationCreateRequest,
  now: Date,
): NormalizedEvaluationCreate {
  if (typeof input !== "object" || input === null) {
    throw new EvaluationValidationError("Request body must be an object");
  }
  if (!UUID_PATTERN.test(input.datasetRevisionId)) {
    throw new EvaluationValidationError("datasetRevisionId must be a UUID");
  }
  return {
    datasetRevisionId: input.datasetRevisionId,
    evaluator: normalizeEvaluator(input.evaluator),
    traceSelector: normalizeSelector(input.traceSelector, now),
  };
}

function normalizeEvaluator(
  input: EvaluatorDefinition,
): EvaluatorDefinition {
  if (typeof input !== "object" || input === null) {
    throw new EvaluationValidationError("evaluator must be an object");
  }
  const name = requiredText(input.name, "evaluator.name", 120);
  if (!Number.isInteger(input.version) || input.version <= 0) {
    throw new EvaluationValidationError(
      "evaluator.version must be a positive integer",
    );
  }
  if (!EVALUATOR_KINDS.has(input.kind)) {
    throw new EvaluationValidationError("Unsupported evaluator kind");
  }
  switch (input.kind) {
    case "exact":
      return {
        name,
        version: input.version,
        kind: input.kind,
        config: {
          ...(input.config.ignoreCase === undefined
            ? {}
            : { ignoreCase: input.config.ignoreCase }),
        },
      };
    case "contains":
      return {
        name,
        version: input.version,
        kind: input.kind,
        config: {
          value: requiredText(
            input.config.value,
            "evaluator.config.value",
            1000,
          ),
          ...(input.config.ignoreCase === undefined
            ? {}
            : { ignoreCase: input.config.ignoreCase }),
        },
      };
    case "regex":
      try {
        new RegExp(input.config.pattern, input.config.ignoreCase ? "i" : "");
      } catch {
        throw new EvaluationValidationError("evaluator regex is invalid");
      }
      return {
        name,
        version: input.version,
        kind: input.kind,
        config: {
          pattern: requiredText(
            input.config.pattern,
            "evaluator.config.pattern",
            500,
          ),
          ...(input.config.ignoreCase === undefined
            ? {}
            : { ignoreCase: input.config.ignoreCase }),
        },
      };
    case "json_valid":
      return { name, version: input.version, kind: input.kind, config: {} };
    case "max_latency_ms":
    case "max_cost_micros":
    case "max_tool_errors":
      if (
        typeof input.config.value !== "number" ||
        !Number.isFinite(input.config.value) ||
        input.config.value < 0
      ) {
        throw new EvaluationValidationError(
          "evaluator.config.value must be a non-negative number",
        );
      }
      return {
        name,
        version: input.version,
        kind: input.kind,
        config: { value: input.config.value },
      };
    case "llm_judge":
      return normalizeLlmJudge({ ...input, name });
  }
}

function normalizeLlmJudge(input: LlmJudgeDefinition): LlmJudgeDefinition {
  if (input.config.allowExternalContent !== true) {
    throw new EvaluationValidationError(
      "llm_judge requires allowExternalContent=true",
    );
  }
  const model = requiredText(input.config.model, "evaluator.config.model", 120);
  const rubric = requiredText(
    input.config.rubric,
    "evaluator.config.rubric",
    8000,
  );
  if (rubric.length < 20) {
    throw new EvaluationValidationError(
      "evaluator.config.rubric must be at least 20 characters",
    );
  }
  if (
    input.config.temperature !== undefined &&
    (!Number.isFinite(input.config.temperature) ||
      input.config.temperature < 0 ||
      input.config.temperature > 2)
  ) {
    throw new EvaluationValidationError(
      "evaluator.config.temperature must be between 0 and 2",
    );
  }
  return {
    name: input.name,
    version: input.version,
    kind: "llm_judge",
    config: {
      model,
      rubric,
      allowExternalContent: true,
      ...(input.config.temperature === undefined
        ? {}
        : { temperature: input.config.temperature }),
    },
  };
}

function normalizeSelector(
  input: EvaluationTraceSelector,
  now: Date,
): NormalizedEvaluationTraceSelector {
  if (typeof input !== "object" || input === null) {
    throw new EvaluationValidationError("traceSelector must be an object");
  }
  if (
    input.environment !== undefined &&
    !ENVIRONMENTS.has(input.environment)
  ) {
    throw new EvaluationValidationError("Invalid traceSelector.environment");
  }
  const startedBefore =
    parseDate(input.startedBefore, "traceSelector.startedBefore") ??
    now.toISOString();
  const startedAfter =
    parseDate(input.startedAfter, "traceSelector.startedAfter") ??
    new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  if (new Date(startedBefore) < new Date(startedAfter)) {
    throw new EvaluationValidationError(
      "traceSelector.startedBefore must be later than startedAfter",
    );
  }
  return {
    ...optionalEntry(
      "appName",
      optionalText(input.appName, "traceSelector.appName", 256),
    ),
    ...optionalEntry(
      "promptVersion",
      optionalText(
        input.promptVersion,
        "traceSelector.promptVersion",
        256,
      ),
    ),
    ...optionalEntry(
      "serviceVersion",
      optionalText(
        input.serviceVersion,
        "traceSelector.serviceVersion",
        256,
      ),
    ),
    ...optionalEntry("environment", input.environment),
    startedAfter,
    startedBefore,
  };
}

function parseDate(
  value: string | undefined,
  name: string,
): string | undefined {
  const normalized = optionalText(value, name, 64);
  if (normalized === undefined) {
    return undefined;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new EvaluationValidationError(`${name} must be an ISO timestamp`);
  }
  return parsed.toISOString();
}

function requiredText(value: string, name: string, max: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "" || normalized.length > max) {
    throw new EvaluationValidationError(`${name} must be 1-${max} characters`);
  }
  return normalized;
}

function optionalText(
  value: string | undefined,
  name: string,
  max: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new EvaluationValidationError(`${name} must be text`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new EvaluationValidationError(
      `${name} must be at most ${max} characters`,
    );
  }
  return normalized === "" ? undefined : normalized;
}

function optionalEntry<Key extends string, Value>(
  key: Key,
  value: Value | undefined,
): Partial<Record<Key, Value>> {
  return value === undefined ? {} : ({ [key]: value } as Record<Key, Value>);
}
