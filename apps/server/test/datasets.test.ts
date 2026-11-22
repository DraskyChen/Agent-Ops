import { describe, expect, it, vi } from "vitest";

import type { HumanPrincipal } from "../src/application/auth.js";
import type {
  ContentRecord,
  ContentService,
} from "../src/application/content.js";
import {
  DatasetCaseConflictError,
  DatasetTraceUnavailableError,
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
});

function repository(
  overrides: Partial<DatasetRepository> = {},
): DatasetRepository {
  return {
    list: async () => [],
    get: async () => datasetDetail(),
    getRevision: async () => null,
    create: async () => datasetSummary(),
    loadTraceSnapshots: async () => [],
    createRevision: async () => {
      throw new Error("not configured");
    },
    ...overrides,
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
