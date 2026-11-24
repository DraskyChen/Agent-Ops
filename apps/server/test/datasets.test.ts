import { describe, expect, it, vi } from "vitest";

import type { HumanPrincipal } from "../src/application/auth.js";
import type {
  ContentRecord,
  ContentService,
} from "../src/application/content.js";
import {
  DatasetCaseConflictError,
  DatasetTraceUnavailableError,
  compareDatasetRevisionSnapshots,
  createDatasetService,
  type DatasetRepository,
} from "../src/application/datasets.js";

const principal: HumanPrincipal = {
  subject: "reviewer-1",
  displayName: "Reviewer One",
  email: null,
  role: "reviewer",
};

describe("dataset service", () => {
  it("normalizes dataset metadata before persistence", async () => {
    const create = vi.fn().mockResolvedValue(datasetSummary());
    const datasets = createDatasetService(repository({ create }), content());

    await datasets.create(principal, {
      name: " Refund regressions ",
      description: " Release gate ",
    });

    expect(create).toHaveBeenCalledWith(principal, {
      name: "Refund regressions",
      description: "Release gate",
    });
  });

  it("copies trace and expected content into a dataset-owned snapshot", async () => {
    const copy = vi
      .fn()
      .mockResolvedValueOnce(contentRecord("copied-input"))
      .mockResolvedValueOnce(contentRecord("copied-output"));
    const upload = vi
      .fn()
      .mockResolvedValue(contentRecord("copied-expected"));
    const createRevision = vi.fn().mockResolvedValue({
      revisionId: "revision-1",
      datasetId: "00000000-0000-4000-8000-000000000001",
      revision: 1,
      itemCount: 1,
      note: "baseline",
      createdBy: "Reviewer One",
      createdAt: "2026-11-22T10:00:00.000Z",
      items: [],
    });
    const loadTraceSnapshots = vi.fn().mockResolvedValue([
      {
        traceId: "trace-1",
        appName: "refund-agent",
        promptVersion: "refund-v1",
        evalCaseId: "refund-case-001",
        taskType: "refund",
        model: "deepseek-flash",
        environment: "test",
        runStatus: "success",
        sourceStartedAt: "2026-11-22T09:00:00.000Z",
        ingestState: "sealed_complete",
        inputContentRef: "source-input",
        outputContentRef: "source-output",
      },
    ]);
    const datasets = createDatasetService(
      repository({ createRevision, loadTraceSnapshots }),
      content({ copy, upload }),
      { contentRetentionDays: 180 },
    );

    await datasets.createRevision(
      "00000000-0000-4000-8000-000000000001",
      principal,
      {
        note: " baseline ",
        items: [
          {
            traceId: "trace-1",
            expectedOutput: "Refund completed",
            expectedBehavior: "Do not promise a refund before tool success",
            tags: ["refund", "refund"],
          },
        ],
      },
    );

    expect(copy).toHaveBeenNthCalledWith(1, {
      contentId: "source-input",
      actorSubject: "reviewer-1",
      ownerApp: "agent-ops-datasets",
      contentKind: "dataset_input",
      retentionDays: 180,
    });
    expect(copy).toHaveBeenNthCalledWith(2, {
      contentId: "source-output",
      actorSubject: "reviewer-1",
      ownerApp: "agent-ops-datasets",
      contentKind: "dataset_baseline_output",
      retentionDays: 180,
    });
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerApp: "agent-ops-datasets",
        contentKind: "dataset_expected_output",
        body: Buffer.from("Refund completed"),
      }),
      { retentionDays: 180 },
    );
    expect(createRevision).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000001",
      principal,
      {
        note: "baseline",
        items: [
          expect.objectContaining({
            caseId: "refund-case-001",
            inputContentRef: "copied-input",
            baselineOutputContentRef: "copied-output",
            expectedOutputContentRef: "copied-expected",
            tags: ["refund"],
          }),
        ],
      },
    );
  });

  it("creates a next revision from historical snapshots without re-reading source traces", async () => {
    const datasetId = "00000000-0000-4000-8000-000000000001";
    const baseRevisionId = "00000000-0000-4000-8000-000000000002";
    const sourceItemId = "00000000-0000-4000-8000-000000000003";
    const copy = vi
      .fn()
      .mockResolvedValueOnce(contentRecord("next-input"))
      .mockResolvedValueOnce(contentRecord("next-baseline"))
      .mockResolvedValueOnce(contentRecord("next-expected"));
    const loadTraceSnapshots = vi.fn();
    const createRevision = vi.fn().mockResolvedValue({
      revisionId: "00000000-0000-4000-8000-000000000004",
      datasetId,
      revision: 2,
      itemCount: 1,
      note: "Derived from revision 1",
      createdBy: "Reviewer One",
      createdAt: "2026-11-24T10:00:00.000Z",
      items: [],
    });
    const datasets = createDatasetService(
      repository({
        getRevision: vi.fn().mockResolvedValue({
          revisionId: baseRevisionId,
          datasetId,
          revision: 1,
          itemCount: 1,
          note: "Baseline",
          createdBy: "Reviewer One",
          createdAt: "2026-11-23T10:00:00.000Z",
          items: [
            {
              itemId: sourceItemId,
              caseId: "refund-case-001",
              sourceTraceId: "trace-1",
              appName: "refund-agent",
              promptVersion: "refund-v1",
              taskType: "refund",
              model: "deepseek-flash",
              environment: "test",
              runStatus: "success",
              sourceStartedAt: "2026-11-23T09:00:00.000Z",
              inputContentRef: "prior-input",
              baselineOutputContentRef: "prior-baseline",
              expectedOutputContentRef: "prior-expected",
              expectedBehavior: "Original behavior",
              tags: ["refund", "regression"],
            },
          ],
        }),
        loadTraceSnapshots,
        createRevision,
      }),
      content({ copy }),
      { contentRetentionDays: 180 },
    );

    await datasets.createRevision(datasetId, principal, {
      baseRevisionId,
      note: "Derived from revision 1",
      items: [
        {
          sourceRevisionItemId: sourceItemId,
          expectedBehavior: "Updated behavior",
        },
      ],
    });

    expect(loadTraceSnapshots).not.toHaveBeenCalled();
    expect(copy).toHaveBeenNthCalledWith(1, {
      contentId: "prior-input",
      actorSubject: "reviewer-1",
      ownerApp: "agent-ops-datasets",
      contentKind: "dataset_input",
      retentionDays: 180,
    });
    expect(copy).toHaveBeenNthCalledWith(2, {
      contentId: "prior-baseline",
      actorSubject: "reviewer-1",
      ownerApp: "agent-ops-datasets",
      contentKind: "dataset_baseline_output",
      retentionDays: 180,
    });
    expect(copy).toHaveBeenNthCalledWith(3, {
      contentId: "prior-expected",
      actorSubject: "reviewer-1",
      ownerApp: "agent-ops-datasets",
      contentKind: "dataset_expected_output",
      retentionDays: 180,
    });
    expect(createRevision).toHaveBeenCalledWith(
      datasetId,
      principal,
      {
        note: "Derived from revision 1",
        items: [
          expect.objectContaining({
            caseId: "refund-case-001",
            sourceTraceId: "trace-1",
            inputContentRef: "next-input",
            baselineOutputContentRef: "next-baseline",
            expectedOutputContentRef: "next-expected",
            expectedBehavior: "Updated behavior",
            tags: ["refund", "regression"],
          }),
        ],
      },
    );
  });

  it("rejects incomplete traces and duplicate case IDs before copying content", async () => {
    const copy = vi.fn();
    const datasets = createDatasetService(
      repository({
        loadTraceSnapshots: vi.fn().mockResolvedValue([
          {
            traceId: "trace-1",
            appName: "refund-agent",
            promptVersion: "refund-v1",
            evalCaseId: "same-case",
            taskType: "refund",
            model: "deepseek-flash",
            environment: "test",
            runStatus: "success",
            sourceStartedAt: null,
            ingestState: "sealed_complete",
            inputContentRef: "input-1",
            outputContentRef: "output-1",
          },
          {
            traceId: "trace-2",
            appName: "refund-agent",
            promptVersion: "refund-v1",
            evalCaseId: "same-case",
            taskType: "refund",
            model: "deepseek-flash",
            environment: "test",
            runStatus: "success",
            sourceStartedAt: null,
            ingestState: "sealed_complete",
            inputContentRef: "input-2",
            outputContentRef: "output-2",
          },
        ]),
      }),
      content({ copy }),
    );

    await expect(
      datasets.createRevision(
        "00000000-0000-4000-8000-000000000001",
        principal,
        {
          items: [{ traceId: "trace-1" }, { traceId: "trace-2" }],
        },
      ),
    ).rejects.toBeInstanceOf(DatasetCaseConflictError);
    expect(copy).not.toHaveBeenCalled();

    const incomplete = createDatasetService(
      repository({
        loadTraceSnapshots: vi.fn().mockResolvedValue([
          {
            traceId: "trace-3",
            appName: "refund-agent",
            promptVersion: "refund-v1",
            evalCaseId: "case-3",
            taskType: "refund",
            model: null,
            environment: "test",
            runStatus: "success",
            sourceStartedAt: null,
            ingestState: "open",
            inputContentRef: "input-3",
            outputContentRef: "output-3",
          },
        ]),
      }),
      content({ copy }),
    );

    await expect(
      incomplete.createRevision(
        "00000000-0000-4000-8000-000000000001",
        principal,
        { items: [{ traceId: "trace-3" }] },
      ),
    ).rejects.toBeInstanceOf(DatasetTraceUnavailableError);
  });

  it("discards snapshot objects when revision persistence fails", async () => {
    const discard = vi.fn().mockResolvedValue(undefined);
    const copy = vi
      .fn()
      .mockResolvedValueOnce(contentRecord("copied-input"))
      .mockResolvedValueOnce(contentRecord("copied-output"));
    const upload = vi
      .fn()
      .mockResolvedValue(contentRecord("copied-expected"));
    const datasets = createDatasetService(
      repository({
        loadTraceSnapshots: vi.fn().mockResolvedValue([
          {
            traceId: "trace-1",
            appName: "refund-agent",
            promptVersion: "refund-v1",
            evalCaseId: "refund-case-001",
            taskType: "refund",
            model: "deepseek-flash",
            environment: "test",
            runStatus: "success",
            sourceStartedAt: null,
            ingestState: "sealed_complete",
            inputContentRef: "source-input",
            outputContentRef: "source-output",
          },
        ]),
        createRevision: vi.fn().mockRejectedValue(new Error("database failed")),
      }),
      content({ copy, upload, discard }),
    );

    await expect(
      datasets.createRevision(
        "00000000-0000-4000-8000-000000000001",
        principal,
        {
          items: [
            {
              traceId: "trace-1",
              expectedOutput: "Refund completed",
            },
          ],
        },
      ),
    ).rejects.toThrow("database failed");
    expect(discard).toHaveBeenCalledTimes(3);
  });

  it("compares revisions by content hashes and case metadata", () => {
    const baselineItem = {
      itemId: "item-1",
      caseId: "case-1",
      sourceTraceId: "trace-1",
      appName: "refund-agent",
      promptVersion: "refund-v1",
      taskType: "refund",
      model: "deepseek-flash",
      environment: "test" as const,
      runStatus: "success" as const,
      sourceStartedAt: "2026-11-24T10:00:00.000Z",
      inputContentRef: "input-1",
      baselineOutputContentRef: "baseline-1",
      expectedOutputContentRef: "expected-1",
      expectedBehavior: "Verify first",
      tags: ["refund"],
      inputSha256: "input-hash",
      baselineOutputSha256: "baseline-hash",
      expectedOutputSha256: "expected-hash",
    };
    const diff = compareDatasetRevisionSnapshots(
      "00000000-0000-4000-8000-000000000001",
      {
        summary: revisionSummary(1),
        items: [
          baselineItem,
          { ...baselineItem, itemId: "item-old", caseId: "removed-case" },
        ],
      },
      {
        summary: revisionSummary(2),
        items: [
          {
            ...baselineItem,
            itemId: "item-2",
            inputContentRef: "input-2",
            expectedOutputContentRef: "expected-2",
            expectedOutputSha256: "expected-hash-2",
            expectedBehavior: "Verify order and window",
          },
          { ...baselineItem, itemId: "item-new", caseId: "added-case" },
        ],
      },
    );

    expect(diff).toMatchObject({
      addedCount: 1,
      removedCount: 1,
      changedCount: 1,
      unchangedCount: 0,
    });
    expect(diff.items.find((item) => item.caseId === "case-1")).toMatchObject({
      status: "changed",
      changes: ["expected_output", "expected_behavior"],
    });
  });
});

function repository(
  overrides: Partial<DatasetRepository> = {},
): DatasetRepository {
  return {
    list: async () => [],
    get: async () => datasetDetail(),
    getRevision: async () => null,
    getRevisionSnapshot: async () => null,
    create: async () => datasetSummary(),
    loadTraceSnapshots: async () => [],
    createRevision: async () => {
      throw new Error("not configured");
    },
    ...overrides,
  };
}

function revisionSummary(revision: number) {
  return {
    revisionId: `revision-${revision}`,
    datasetId: "00000000-0000-4000-8000-000000000001",
    revision,
    itemCount: 1,
    note: null,
    createdBy: "Reviewer One",
    createdAt: "2026-11-24T10:00:00.000Z",
  };
}

function content(
  overrides: Partial<ContentService> = {},
): ContentService {
  return {
    upload: async () => contentRecord("uploaded"),
    get: async () => {
      throw new Error("not configured");
    },
    copy: async () => contentRecord("copied"),
    discard: async () => undefined,
    auditDenied: async () => undefined,
    ...overrides,
  };
}

function datasetSummary() {
  return {
    datasetId: "00000000-0000-4000-8000-000000000001",
    name: "Refund regressions",
    description: null,
    latestRevision: null,
    itemCount: 0,
    createdBy: "Reviewer One",
    createdAt: "2026-11-22T10:00:00.000Z",
    updatedAt: "2026-11-22T10:00:00.000Z",
  };
}

function datasetDetail() {
  return {
    ...datasetSummary(),
    revisions: [],
  };
}

function contentRecord(contentId: string): ContentRecord {
  return {
    contentId,
    objectKey: `content/${contentId}.txt`,
    ownerApp: "agent-ops-datasets",
    contentKind: "dataset_input",
    mediaType: "text/plain",
    captureMode: "full",
    sizeBytes: 1,
    sha256: "hash",
    redactionRuleVersion: "v1",
    encryption: "managed",
    status: "available",
    expiresAt: null,
  };
}
