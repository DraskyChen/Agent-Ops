import type {
  DatasetCreateRequest,
  DatasetDetail,
  DatasetItemDraft,
  DatasetItem,
  DatasetRevisionChangeKind,
  DatasetRevisionCreateRequest,
  DatasetRevisionDiff,
  DatasetRevisionDetail,
  DatasetRevisionSummary,
  DatasetSummary,
  Environment,
  RunStatus,
} from "@agent-ops/contracts";

import {
  ContentExpiredError,
  ContentNotFoundError,
  ContentStorageError,
  ContentTooLargeError,
  type ContentRecord,
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

export interface DatasetRevisionItemSnapshot extends DatasetItem {
  inputSha256: string | null;
  baselineOutputSha256: string | null;
  expectedOutputSha256: string | null;
}

export interface DatasetRevisionSnapshot {
  summary: DatasetRevisionSummary;
  items: DatasetRevisionItemSnapshot[];
}

export interface DatasetRepository {
  list(): Promise<DatasetSummary[]>;
  get(datasetId: string): Promise<DatasetDetail | null>;
  getRevision(
    datasetId: string,
    revisionId: string,
  ): Promise<DatasetRevisionDetail | null>;
  getRevisionSnapshot(
    datasetId: string,
    revisionId: string,
  ): Promise<DatasetRevisionSnapshot | null>;
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
  compareRevisions(
    datasetId: string,
    baselineRevisionId: string,
    candidateRevisionId: string,
  ): Promise<DatasetRevisionDiff | null>;
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

export class DatasetRevisionUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatasetRevisionUnavailableError";
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

    async compareRevisions(
      datasetId,
      baselineRevisionId,
      candidateRevisionId,
    ) {
      if (
        !UUID_PATTERN.test(datasetId) ||
        !UUID_PATTERN.test(baselineRevisionId) ||
        !UUID_PATTERN.test(candidateRevisionId)
      ) {
        return null;
      }
      if (baselineRevisionId === candidateRevisionId) {
        throw new DatasetValidationError(
          "Two distinct dataset revisions are required",
        );
      }
      const [baseline, candidate] = await Promise.all([
        repository.getRevisionSnapshot(datasetId, baselineRevisionId),
        repository.getRevisionSnapshot(datasetId, candidateRevisionId),
      ]);
      if (baseline === null || candidate === null) {
        return null;
      }
      return compareDatasetRevisionSnapshots(datasetId, baseline, candidate);
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

      const baseRevision =
        normalized.baseRevisionId === null
          ? null
          : await repository.getRevision(
              datasetId,
              normalized.baseRevisionId,
            );
      if (
        normalized.baseRevisionId !== null &&
        baseRevision === null
      ) {
        throw new DatasetRevisionUnavailableError(
          "The base dataset revision was not found",
        );
      }
      const baseItemsById = new Map(
        (baseRevision?.items ?? []).map((item) => [item.itemId, item]),
      );
      const traceDrafts = normalized.items.filter(
        (item) => item.traceId !== null,
      );
      const snapshots =
        traceDrafts.length === 0
          ? []
          : await repository.loadTraceSnapshots(
              traceDrafts.map((item) => item.traceId as string),
            );
      const snapshotByTraceId = new Map(
        snapshots.map((snapshot) => [snapshot.traceId, snapshot]),
      );
      const seenCaseIds = new Set<string>();
      const resolvedItems: Array<{
        draft: NormalizedRevisionItemDraft;
        source: {
          traceId: string;
          appName: string | null;
          promptVersion: string | null;
          taskType: string | null;
          model: string | null;
          environment: Environment | null;
          runStatus: RunStatus | null;
          sourceStartedAt: string | null;
          inputContentRef: string;
          baselineOutputContentRef: string;
          previousExpectedOutputContentRef: string | null;
        };
        caseId: string;
        expectedBehavior: string | null;
        tags: string[];
      }> = [];
      const items: NormalizedDatasetItem[] = [];
      const copiedContentIds: string[] = [];

      for (const draft of normalized.items) {
        const previous =
          draft.sourceRevisionItemId === null
            ? undefined
            : baseItemsById.get(draft.sourceRevisionItemId);
        if (
          draft.sourceRevisionItemId !== null &&
          previous === undefined
        ) {
          throw new DatasetRevisionUnavailableError(
            `Dataset item ${draft.sourceRevisionItemId} is not part of the base revision`,
          );
        }
        const snapshot =
          draft.traceId === null
            ? undefined
            : snapshotByTraceId.get(draft.traceId);
        if (draft.traceId !== null) {
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
        }

        const source =
          previous === undefined
            ? {
                traceId: snapshot!.traceId,
                appName: snapshot!.appName,
                promptVersion: snapshot!.promptVersion,
                taskType: snapshot!.taskType,
                model: snapshot!.model,
                environment: snapshot!.environment,
                runStatus: snapshot!.runStatus,
                sourceStartedAt: snapshot!.sourceStartedAt,
                inputContentRef: snapshot!.inputContentRef!,
                baselineOutputContentRef: snapshot!.outputContentRef!,
                previousExpectedOutputContentRef: null,
              }
            : {
                traceId: previous.sourceTraceId,
                appName: previous.appName,
                promptVersion: previous.promptVersion,
                taskType: previous.taskType,
                model: previous.model,
                environment: previous.environment,
                runStatus: previous.runStatus,
                sourceStartedAt: previous.sourceStartedAt,
                inputContentRef: previous.inputContentRef,
                baselineOutputContentRef:
                  previous.baselineOutputContentRef,
                previousExpectedOutputContentRef:
                  previous.expectedOutputContentRef,
              };
        const caseId = normalizeCaseId(
          draft.caseId ?? previous?.caseId ?? snapshot?.evalCaseId ?? null,
        );
        if (seenCaseIds.has(caseId)) {
          throw new DatasetCaseConflictError(
            `Duplicate caseId ${caseId} in dataset revision`,
          );
        }
        seenCaseIds.add(caseId);
        resolvedItems.push({
          draft,
          source,
          caseId,
          expectedBehavior:
            draft.expectedBehavior === undefined
              ? previous?.expectedBehavior ?? null
              : draft.expectedBehavior,
          tags:
            draft.tags === undefined
              ? previous?.tags ?? []
              : draft.tags,
        });
      }

      for (const {
        draft,
        source,
        caseId,
        expectedBehavior,
        tags,
      } of resolvedItems) {
        try {
          const inputContent = await content.copy({
            contentId: source.inputContentRef,
            actorSubject: principal.subject,
            ownerApp: DATASET_CONTENT_OWNER,
            contentKind: "dataset_input",
            retentionDays: contentRetentionDays,
          });
          const baselineOutput = await content.copy({
            contentId: source.baselineOutputContentRef,
            actorSubject: principal.subject,
            ownerApp: DATASET_CONTENT_OWNER,
            contentKind: "dataset_baseline_output",
            retentionDays: contentRetentionDays,
          });
          let expectedOutput: ContentRecord | null = null;
          if (draft.expectedOutput === undefined) {
            if (source.previousExpectedOutputContentRef !== null) {
              expectedOutput = await content.copy({
                contentId: source.previousExpectedOutputContentRef,
                actorSubject: principal.subject,
                ownerApp: DATASET_CONTENT_OWNER,
                contentKind: "dataset_expected_output",
                retentionDays: contentRetentionDays,
              });
            }
          } else if (draft.expectedOutput !== null) {
            expectedOutput = await content.upload(
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
          }
          copiedContentIds.push(
            inputContent.contentId,
            baselineOutput.contentId,
            ...(expectedOutput === null ? [] : [expectedOutput.contentId]),
          );

          items.push({
            caseId,
            sourceTraceId: source.traceId,
            appName: source.appName,
            promptVersion: source.promptVersion,
            taskType: source.taskType,
            model: source.model,
            environment: source.environment,
            runStatus: source.runStatus,
            sourceStartedAt: source.sourceStartedAt,
            inputContentRef: inputContent.contentId,
            baselineOutputContentRef: baselineOutput.contentId,
            expectedOutputContentRef: expectedOutput?.contentId ?? null,
            expectedBehavior,
            tags,
          });
        } catch (error) {
          if (
            error instanceof ContentNotFoundError ||
            error instanceof ContentExpiredError ||
            error instanceof ContentStorageError ||
            error instanceof ContentTooLargeError
          ) {
            await discardCopiedContent(content, copiedContentIds);
            throw draft.sourceRevisionItemId === null
              ? new DatasetTraceUnavailableError(
                  `Content for trace ${draft.traceId} is unavailable for snapshotting`,
                )
              : new DatasetRevisionUnavailableError(
                  `Content for dataset item ${draft.sourceRevisionItemId} is unavailable for snapshotting`,
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

export function compareDatasetRevisionSnapshots(
  datasetId: string,
  baseline: DatasetRevisionSnapshot,
  candidate: DatasetRevisionSnapshot,
): DatasetRevisionDiff {
  const baselineItems = new Map(
    baseline.items.map((item) => [item.caseId, item]),
  );
  const candidateItems = new Map(
    candidate.items.map((item) => [item.caseId, item]),
  );
  const caseIds = [
    ...new Set([...baselineItems.keys(), ...candidateItems.keys()]),
  ].sort();
  const items = caseIds.map((caseId) => {
    const before = baselineItems.get(caseId) ?? null;
    const after = candidateItems.get(caseId) ?? null;
    const changes =
      before === null || after === null
        ? []
        : datasetItemChanges(before, after);
    return {
      caseId,
      status:
        before === null
          ? ("added" as const)
          : after === null
            ? ("removed" as const)
            : changes.length === 0
              ? ("unchanged" as const)
              : ("changed" as const),
      changes,
      baseline: before === null ? null : publicDatasetItem(before),
      candidate: after === null ? null : publicDatasetItem(after),
    };
  });
  return {
    datasetId,
    baseline: baseline.summary,
    candidate: candidate.summary,
    addedCount: items.filter((item) => item.status === "added").length,
    removedCount: items.filter((item) => item.status === "removed").length,
    changedCount: items.filter((item) => item.status === "changed").length,
    unchangedCount: items.filter((item) => item.status === "unchanged").length,
    items,
  };
}

function datasetItemChanges(
  baseline: DatasetRevisionItemSnapshot,
  candidate: DatasetRevisionItemSnapshot,
): DatasetRevisionChangeKind[] {
  const changes: DatasetRevisionChangeKind[] = [];
  if (
    baseline.sourceTraceId !== candidate.sourceTraceId ||
    baseline.appName !== candidate.appName ||
    baseline.promptVersion !== candidate.promptVersion ||
    baseline.taskType !== candidate.taskType ||
    baseline.model !== candidate.model ||
    baseline.environment !== candidate.environment ||
    baseline.runStatus !== candidate.runStatus ||
    baseline.sourceStartedAt !== candidate.sourceStartedAt
  ) {
    changes.push("case_metadata");
  }
  if (baseline.inputSha256 !== candidate.inputSha256) {
    changes.push("input_content");
  }
  if (baseline.baselineOutputSha256 !== candidate.baselineOutputSha256) {
    changes.push("baseline_output");
  }
  if (baseline.expectedOutputSha256 !== candidate.expectedOutputSha256) {
    changes.push("expected_output");
  }
  if (baseline.expectedBehavior !== candidate.expectedBehavior) {
    changes.push("expected_behavior");
  }
  if (JSON.stringify([...baseline.tags].sort()) !== JSON.stringify([...candidate.tags].sort())) {
    changes.push("tags");
  }
  return changes;
}

function publicDatasetItem(
  item: DatasetRevisionItemSnapshot,
): DatasetItem {
  const {
    inputSha256: _inputSha256,
    baselineOutputSha256: _baselineOutputSha256,
    expectedOutputSha256: _expectedOutputSha256,
    ...publicItem
  } = item;
  return publicItem;
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
  traceId: string | null;
  sourceRevisionItemId: string | null;
  caseId: string | null;
  expectedOutput: string | null | undefined;
  expectedBehavior: string | null | undefined;
  tags: string[] | undefined;
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
  baseRevisionId: string | null;
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
  const sourceRevisionItemIds = new Set<string>();
  const items = input.items.map((item, index) =>
    normalizeRevisionItem(
      item,
      index,
      traceIds,
      sourceRevisionItemIds,
    ),
  );
  const baseRevisionId =
    input.baseRevisionId === undefined
      ? null
      : requiredUuid(input.baseRevisionId, "baseRevisionId");
  if (
    baseRevisionId === null &&
    items.some((item) => item.sourceRevisionItemId !== null)
  ) {
    throw new DatasetValidationError(
      "baseRevisionId is required when items reference an existing revision",
    );
  }
  return {
    note: optionalText(input.note, "note", 2000),
    baseRevisionId,
    items,
  };
}

function normalizeRevisionItem(
  item: DatasetItemDraft,
  index: number,
  traceIds: Set<string>,
  sourceRevisionItemIds: Set<string>,
): NormalizedRevisionItemDraft {
  if (typeof item !== "object" || item === null) {
    throw new DatasetValidationError(`items[${index}] must be an object`);
  }
  const traceId =
    item.traceId === undefined
      ? null
      : requiredText(item.traceId, `items[${index}].traceId`, 256);
  const sourceRevisionItemId =
    item.sourceRevisionItemId === undefined
      ? null
      : requiredUuid(
          item.sourceRevisionItemId,
          `items[${index}].sourceRevisionItemId`,
        );
  if (
    (traceId === null && sourceRevisionItemId === null) ||
    (traceId !== null && sourceRevisionItemId !== null)
  ) {
    throw new DatasetValidationError(
      `items[${index}] must specify exactly one of traceId or sourceRevisionItemId`,
    );
  }
  if (traceId !== null && traceIds.has(traceId)) {
    throw new DatasetValidationError(`Duplicate traceId ${traceId}`);
  }
  if (traceId !== null) {
    traceIds.add(traceId);
  }
  if (
    sourceRevisionItemId !== null &&
    sourceRevisionItemIds.has(sourceRevisionItemId)
  ) {
    throw new DatasetValidationError(
      `Duplicate sourceRevisionItemId ${sourceRevisionItemId}`,
    );
  }
  if (sourceRevisionItemId !== null) {
    sourceRevisionItemIds.add(sourceRevisionItemId);
  }
  return {
    traceId,
    sourceRevisionItemId,
    caseId:
      item.caseId === undefined
        ? null
        : normalizeCaseId(item.caseId),
    expectedOutput: optionalNullableText(
      item.expectedOutput,
      `items[${index}].expectedOutput`,
      100_000,
    ),
    expectedBehavior: optionalNullableText(
      item.expectedBehavior,
      `items[${index}].expectedBehavior`,
      4000,
    ),
    tags:
      item.tags === undefined
        ? undefined
        : normalizeTags(item.tags, index),
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

function optionalNullableText(
  value: string | null | undefined,
  name: string,
  max: number,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  return optionalText(value, name, max);
}

function requiredUuid(value: string, name: string): string {
  const normalized = requiredText(value, name, 64);
  if (!UUID_PATTERN.test(normalized)) {
    throw new DatasetValidationError(`${name} must be a UUID`);
  }
  return normalized;
}

