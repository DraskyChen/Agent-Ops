import type {
  DatasetCreateRequest,
  DatasetDetail,
  DatasetItemDraft,
  DatasetRevisionCreateRequest,
  DatasetRevisionDetail,
  DatasetSummary,
  Environment,
  RunStatus,
} from "@agent-ops/contracts";

import {
  ContentExpiredError,
  ContentNotFoundError,
  ContentStorageError,
  ContentTooLargeError,
  type ContentService,
} from "./content.js";
import type { HumanPrincipal } from "./auth.js";

export interface DatasetTraceSnapshot {
  traceId: string;
  appName: string | null;
  promptVersion: string | null;
  evalCaseId: string | null;
  taskType: string | null;
  model: string | null;
  environment: Environment | null;
  runStatus: RunStatus | null;
  sourceStartedAt: string | null;
  ingestState: string;
  inputContentRef: string | null;
  outputContentRef: string | null;
}

export interface NormalizedDatasetCreate {
  name: string;
  description: string | null;
}

export interface NormalizedDatasetItem {
  caseId: string;
  sourceTraceId: string;
  appName: string | null;
  promptVersion: string | null;
  taskType: string | null;
  model: string | null;
  environment: Environment | null;
  runStatus: RunStatus | null;
  sourceStartedAt: string | null;
  inputContentRef: string;
  baselineOutputContentRef: string;
  expectedOutputContentRef: string | null;
  expectedBehavior: string | null;
  tags: string[];
}

export interface NormalizedDatasetRevision {
  note: string | null;
  items: NormalizedDatasetItem[];
}

export interface DatasetRepository {
  list(): Promise<DatasetSummary[]>;
  get(datasetId: string): Promise<DatasetDetail | null>;
  getRevision(
    datasetId: string,
    revisionId: string,
  ): Promise<DatasetRevisionDetail | null>;
  create(
    principal: HumanPrincipal,
    input: NormalizedDatasetCreate,
  ): Promise<DatasetSummary>;
  loadTraceSnapshots(traceIds: string[]): Promise<DatasetTraceSnapshot[]>;
  createRevision(
    datasetId: string,
    principal: HumanPrincipal,
    input: NormalizedDatasetRevision,
  ): Promise<DatasetRevisionDetail>;
}

export interface DatasetService {
  list(): Promise<DatasetSummary[]>;
  get(datasetId: string): Promise<DatasetDetail | null>;
  getRevision(
    datasetId: string,
    revisionId: string,
  ): Promise<DatasetRevisionDetail | null>;
  create(
    principal: HumanPrincipal,
    input: DatasetCreateRequest,
  ): Promise<DatasetSummary>;
  createRevision(
    datasetId: string,
    principal: HumanPrincipal,
    input: DatasetRevisionCreateRequest,
  ): Promise<DatasetRevisionDetail>;
}

export interface DatasetServiceOptions {
  contentRetentionDays?: number;
}

export class DatasetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetValidationError";
  }
}

export class DatasetNotFoundError extends Error {
  constructor() {
    super("Dataset not found");
    this.name = "DatasetNotFoundError";
  }
}

export class DatasetNameConflictError extends Error {
  constructor() {
    super("A dataset with this name already exists");
    this.name = "DatasetNameConflictError";
  }
}

export class DatasetTraceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetTraceUnavailableError";
  }
}

export class DatasetCaseConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetCaseConflictError";
  }
}

const DATASET_CONTENT_OWNER = "agent-ops-datasets";
const DATASET_CONTENT_RULE_VERSION = "dataset-snapshot-v1";
const CASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createDatasetService(
  repository: DatasetRepository,
  content: ContentService,
  options: DatasetServiceOptions = {},
): DatasetService {
  const contentRetentionDays = options.contentRetentionDays ?? 180;
  return {
    list() {
      return repository.list();
    },

    get(datasetId) {
      if (!UUID_PATTERN.test(datasetId)) {
        return Promise.resolve(null);
      }
      return repository.get(datasetId);
    },

    getRevision(datasetId, revisionId) {
      if (!UUID_PATTERN.test(datasetId) || !UUID_PATTERN.test(revisionId)) {
        return Promise.resolve(null);
      }
      return repository.getRevision(datasetId, revisionId);
    },

    create(principal, input) {
      return repository.create(principal, normalizeDatasetCreate(input));
    },

    async createRevision(datasetId, principal, input) {
      if (!UUID_PATTERN.test(datasetId)) {
        throw new DatasetNotFoundError();
      }
      const normalized = normalizeRevisionInput(input);
      const dataset = await repository.get(datasetId);
      if (dataset === null) {
        throw new DatasetNotFoundError();
      }

      const snapshots = await repository.loadTraceSnapshots(
        normalized.items.map((item) => item.traceId),
      );
      const snapshotByTraceId = new Map(
        snapshots.map((snapshot) => [snapshot.traceId, snapshot]),
      );
      const seenCaseIds = new Set<string>();
      const resolvedItems: Array<{
        draft: NormalizedRevisionItemDraft;
        snapshot: DatasetTraceSnapshot & {
          inputContentRef: string;
          outputContentRef: string;
        };
        caseId: string;
      }> = [];
      const items: NormalizedDatasetItem[] = [];
      const copiedContentIds: string[] = [];

      for (const draft of normalized.items) {
        const snapshot = snapshotByTraceId.get(draft.traceId);
        if (snapshot === undefined) {
          throw new DatasetTraceUnavailableError(
            `Trace ${draft.traceId} was not found`,
          );
        }
        if (snapshot.ingestState !== "sealed_complete") {
          throw new DatasetTraceUnavailableError(
            `Trace ${draft.traceId} must be sealed_complete`,
          );
        }
        if (
          snapshot.inputContentRef === null ||
          snapshot.outputContentRef === null
        ) {
          throw new DatasetTraceUnavailableError(
            `Trace ${draft.traceId} does not have captured input and output content`,
          );
        }

        const caseId = normalizeCaseId(draft.caseId ?? snapshot.evalCaseId);
        if (seenCaseIds.has(caseId)) {
          throw new DatasetCaseConflictError(
            `Duplicate caseId ${caseId} in dataset revision`,
          );
        }
        seenCaseIds.add(caseId);
        resolvedItems.push({
          draft,
          snapshot: {
            ...snapshot,
            inputContentRef: snapshot.inputContentRef,
            outputContentRef: snapshot.outputContentRef,
          },
          caseId,
        });
      }

      for (const { draft, snapshot, caseId } of resolvedItems) {
        try {
          const inputContent = await content.copy({
            contentId: snapshot.inputContentRef,
            actorSubject: principal.subject,
            ownerApp: DATASET_CONTENT_OWNER,
            contentKind: "dataset_input",
            retentionDays: contentRetentionDays,
          });
          const baselineOutput = await content.copy({
            contentId: snapshot.outputContentRef,
            actorSubject: principal.subject,
            ownerApp: DATASET_CONTENT_OWNER,
            contentKind: "dataset_baseline_output",
            retentionDays: contentRetentionDays,
          });
          const expectedOutput =
            draft.expectedOutput === null
              ? null
              : await content.upload(
                  {
                    ownerApp: DATASET_CONTENT_OWNER,
                    contentKind: "dataset_expected_output",
                    mediaType: "text/plain; charset=utf-8",
                    captureMode: "full",
                    redactionRuleVersion: DATASET_CONTENT_RULE_VERSION,
                    body: Buffer.from(draft.expectedOutput, "utf8"),
                  },
                  { retentionDays: contentRetentionDays },
                );
          copiedContentIds.push(
            inputContent.contentId,
            baselineOutput.contentId,
            ...(expectedOutput === null ? [] : [expectedOutput.contentId]),
          );

          items.push({
            caseId,
            sourceTraceId: snapshot.traceId,
            appName: snapshot.appName,
            promptVersion: snapshot.promptVersion,
            taskType: snapshot.taskType,
            model: snapshot.model,
            environment: snapshot.environment,
            runStatus: snapshot.runStatus,
            sourceStartedAt: snapshot.sourceStartedAt,
            inputContentRef: inputContent.contentId,
            baselineOutputContentRef: baselineOutput.contentId,
            expectedOutputContentRef: expectedOutput?.contentId ?? null,
            expectedBehavior: draft.expectedBehavior,
            tags: draft.tags,
          });
        } catch (error) {
          if (
            error instanceof ContentNotFoundError ||
            error instanceof ContentExpiredError ||
            error instanceof ContentStorageError ||
            error instanceof ContentTooLargeError
          ) {
            await discardCopiedContent(content, copiedContentIds);
            throw new DatasetTraceUnavailableError(
              `Content for trace ${draft.traceId} is unavailable for snapshotting`,
            );
          }
          await discardCopiedContent(content, copiedContentIds);
          throw error;
        }
      }

      try {
        return await repository.createRevision(datasetId, principal, {
          note: normalized.note,
          items,
        });
      } catch (error) {
        await discardCopiedContent(content, copiedContentIds);
        throw error;
      }
    },
  };
}

async function discardCopiedContent(
  content: ContentService,
  contentIds: string[],
): Promise<void> {
  await Promise.allSettled(
    contentIds.map((contentId) => content.discard(contentId)),
  );
}

interface NormalizedRevisionItemDraft {
  traceId: string;
  caseId: string | null;
  expectedOutput: string | null;
  expectedBehavior: string | null;
  tags: string[];
}

function normalizeDatasetCreate(
  input: DatasetCreateRequest,
): NormalizedDatasetCreate {
  if (typeof input !== "object" || input === null) {
    throw new DatasetValidationError("Request body must be an object");
  }
  const name = requiredText(input.name, "name", 120);
  const description = optionalText(input.description, "description", 2000);
  return { name, description };
}

function normalizeRevisionInput(input: DatasetRevisionCreateRequest): {
  note: string | null;
  items: NormalizedRevisionItemDraft[];
} {
  if (typeof input !== "object" || input === null) {
    throw new DatasetValidationError("Request body must be an object");
  }
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new DatasetValidationError("items must contain 1-200 entries");
  }
  if (input.items.length > 200) {
    throw new DatasetValidationError("items must contain 1-200 entries");
  }
  const traceIds = new Set<string>();
  const items = input.items.map((item, index) =>
    normalizeRevisionItem(item, index, traceIds),
  );
  return {
    note: optionalText(input.note, "note", 2000),
    items,
  };
}

function normalizeRevisionItem(
  item: DatasetItemDraft,
  index: number,
  traceIds: Set<string>,
): NormalizedRevisionItemDraft {
  if (typeof item !== "object" || item === null) {
    throw new DatasetValidationError(`items[${index}] must be an object`);
  }
  const traceId = requiredText(item.traceId, `items[${index}].traceId`, 256);
  if (traceIds.has(traceId)) {
    throw new DatasetValidationError(`Duplicate traceId ${traceId}`);
  }
  traceIds.add(traceId);
  return {
    traceId,
    caseId:
      item.caseId === undefined
        ? null
        : normalizeCaseId(item.caseId),
    expectedOutput: optionalText(
      item.expectedOutput,
      `items[${index}].expectedOutput`,
      100_000,
    ),
    expectedBehavior: optionalText(
      item.expectedBehavior,
      `items[${index}].expectedBehavior`,
      4000,
    ),
    tags: normalizeTags(item.tags, index),
  };
}

function normalizeCaseId(value: string | null): string {
  const normalized = value?.trim() ?? "";
  if (!CASE_ID_PATTERN.test(normalized)) {
    throw new DatasetValidationError(
      "caseId must be 1-128 characters using letters, digits, dot, underscore, colon, or hyphen",
    );
  }
  return normalized;
}

function normalizeTags(
  tags: string[] | undefined,
  itemIndex: number,
): string[] {
  if (tags === undefined) {
    return [];
  }
  if (!Array.isArray(tags) || tags.length > 20) {
    throw new DatasetValidationError(
      `items[${itemIndex}].tags must contain at most 20 entries`,
    );
  }
  const normalized = tags.map((tag, index) =>
    requiredText(
      tag,
      `items[${itemIndex}].tags[${index}]`,
      64,
    ),
  );
  return [...new Set(normalized)];
}

function requiredText(value: string, name: string, max: number): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "" || normalized.length > max) {
    throw new DatasetValidationError(`${name} must be 1-${max} characters`);
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
  if (typeof value !== "string") {
    throw new DatasetValidationError(`${name} must be text`);
  }
  const normalized = value.trim();
  if (normalized.length > max) {
    throw new DatasetValidationError(`${name} must be at most ${max} characters`);
  }
  return normalized === "" ? null : normalized;
}

