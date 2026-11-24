import {
  ArrowRight,
  CircleX,
  GitCompareArrows,
  RefreshCw,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  DatasetItem,
  DatasetRevisionChangeKind,
  DatasetRevisionDiff,
  DatasetRevisionDiffItem,
  DatasetRevisionSummary,
} from "@agent-ops/contracts";

import { fetchContentText } from "../../shared/content.js";
import { fetchDatasetRevisionDiff } from "./api.js";

interface ItemContents {
  baseline: ContentSide;
  candidate: ContentSide;
}

interface ContentSide {
  input: TextContent;
  baselineOutput: TextContent;
  expectedOutput: TextContent;
}

interface TextContent {
  text: string | null;
  error: string | null;
}

export function DatasetRevisionDiffPanel({
  datasetId,
  revisions,
}: {
  datasetId: string;
  revisions: DatasetRevisionSummary[];
}) {
  const [baselineId, setBaselineId] = useState(
    revisions[1]?.revisionId ?? "",
  );
  const [candidateId, setCandidateId] = useState(
    revisions[0]?.revisionId ?? "",
  );
  const [diff, setDiff] = useState<DatasetRevisionDiff | null>(null);
  const [selectedCase, setSelectedCase] =
    useState<DatasetRevisionDiffItem | null>(null);
  const [contents, setContents] = useState<ItemContents | null>(null);
  const [loading, setLoading] = useState(false);
  const [contentLoading, setContentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBaselineId(revisions[1]?.revisionId ?? "");
    setCandidateId(revisions[0]?.revisionId ?? "");
    setDiff(null);
    setSelectedCase(null);
    setContents(null);
    setError(null);
  }, [datasetId]);

  const loadDiff = async () => {
    if (baselineId === "" || candidateId === "" || baselineId === candidateId) {
      setError("Select two distinct revisions.");
      return;
    }
    setLoading(true);
    try {
      const next = await fetchDatasetRevisionDiff(
        datasetId,
        baselineId,
        candidateId,
      );
      setDiff(next);
      setSelectedCase(null);
      setContents(null);
      setError(null);
    } catch (loadError) {
      setDiff(null);
      setError(message(loadError, "Unable to compare dataset revisions"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (
      revisions.length >= 2 &&
      baselineId !== "" &&
      candidateId !== "" &&
      baselineId !== candidateId &&
      revisions.some((revision) => revision.revisionId === baselineId) &&
      revisions.some((revision) => revision.revisionId === candidateId)
    ) {
      void loadDiff();
    }
  }, [baselineId, candidateId, datasetId]);

  const selectItem = async (item: DatasetRevisionDiffItem) => {
    setSelectedCase(item);
    setContentLoading(true);
    try {
      const [baseline, candidate] = await Promise.all([
        loadContents(item.baseline),
        loadContents(item.candidate),
      ]);
      setContents({ baseline, candidate });
      setError(null);
    } catch (loadError) {
      setContents(null);
      setError(message(loadError, "Unable to load revision contents"));
    } finally {
      setContentLoading(false);
    }
  };

  if (revisions.length < 2) {
    return (
      <section className="revision-diff-panel">
        <div className="revision-diff-heading">
          <div>
            <GitCompareArrows size={16} />
            <div>
              <strong>Revision diff</strong>
              <small>Create another revision to compare changes.</small>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="revision-diff-panel">
      <div className="revision-diff-heading">
        <div>
          <GitCompareArrows size={16} />
          <div>
            <strong>Revision diff</strong>
            <small>Compare immutable dataset revisions by case and content.</small>
          </div>
        </div>
        <button
          className="button secondary compact"
          type="button"
          onClick={() => void loadDiff()}
          disabled={loading}
        >
          <RefreshCw size={13} />
          {loading ? "Comparing…" : "Compare"}
        </button>
      </div>
      <div className="revision-diff-controls">
        <label>
          <span>Baseline</span>
          <select
            value={baselineId}
            onChange={(event) => setBaselineId(event.target.value)}
          >
            {revisions.map((revision) => (
              <option key={revision.revisionId} value={revision.revisionId}>
                Revision {revision.revision} · {revision.itemCount} cases
              </option>
            ))}
          </select>
        </label>
        <ArrowRight size={15} />
        <label>
          <span>Candidate</span>
          <select
            value={candidateId}
            onChange={(event) => setCandidateId(event.target.value)}
          >
            {revisions.map((revision) => (
              <option key={revision.revisionId} value={revision.revisionId}>
                Revision {revision.revision} · {revision.itemCount} cases
              </option>
            ))}
          </select>
        </label>
      </div>

      {error === null ? null : (
        <div className="data-error revision-diff-error" role="alert">
          <CircleX size={14} />
          {error}
        </div>
      )}

      {diff === null ? null : (
        <>
          <div className="revision-diff-summary">
            <span className="added">{diff.addedCount} added</span>
            <span className="removed">{diff.removedCount} removed</span>
            <span className="changed">{diff.changedCount} changed</span>
            <span>{diff.unchangedCount} unchanged</span>
          </div>
          <div className="revision-diff-list">
            {diff.items
              .filter((item) => item.status !== "unchanged")
              .map((item) => (
                <button
                  className={`${item.status} ${
                    selectedCase?.caseId === item.caseId ? "selected" : ""
                  }`}
                  type="button"
                  key={item.caseId}
                  onClick={() => void selectItem(item)}
                >
                  <span>
                    <strong>{item.caseId}</strong>
                    <small>
                      {item.changes.length === 0
                        ? item.status
                        : item.changes.map(changeLabel).join(" · ")}
                    </small>
                  </span>
                  <span className={`revision-change-status ${item.status}`}>
                    {item.status}
                  </span>
                </button>
              ))}
            {diff.changedCount + diff.addedCount + diff.removedCount === 0 ? (
              <p className="revision-diff-empty">
                No case changes between these revisions.
              </p>
            ) : null}
          </div>
          {selectedCase === null ? null : (
            <div className="revision-content-diff">
              <div className="panel-heading">
                <div>
                  <strong>{selectedCase.caseId}</strong>
                  <small>
                    {contentLoading
                      ? "Loading captured content…"
                      : "Baseline and candidate snapshot content"}
                  </small>
                </div>
              </div>
              {contents === null ? null : (
                <>
                  <ContentComparison
                    label="Input"
                    baseline={contents.baseline.input}
                    candidate={contents.candidate.input}
                  />
                  <ContentComparison
                    label="Baseline output"
                    baseline={contents.baseline.baselineOutput}
                    candidate={contents.candidate.baselineOutput}
                  />
                  <ContentComparison
                    label="Expected output"
                    baseline={contents.baseline.expectedOutput}
                    candidate={contents.candidate.expectedOutput}
                  />
                  {selectedCase.baseline?.expectedBehavior !==
                    selectedCase.candidate?.expectedBehavior && (
                    <div className="expected-behavior-diff">
                      <span>Expected behavior</span>
                      <div>
                        <pre>
                          {selectedCase.baseline?.expectedBehavior ??
                            "Not specified"}
                        </pre>
                        <pre>
                          {selectedCase.candidate?.expectedBehavior ??
                            "Not specified"}
                        </pre>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function ContentComparison({
  label,
  baseline,
  candidate,
}: {
  label: string;
  baseline: TextContent;
  candidate: TextContent;
}) {
  if (
    baseline.error === null &&
    candidate.error === null &&
    baseline.text === candidate.text
  ) {
    return null;
  }
  return (
    <div className="revision-content-row">
      <span>{label}</span>
      <div>
        <pre>{displayText(baseline)}</pre>
        <pre>{displayText(candidate)}</pre>
      </div>
    </div>
  );
}

async function loadContents(item: DatasetItem | null): Promise<ContentSide> {
  if (item === null) {
    return {
      input: { text: null, error: null },
      baselineOutput: { text: null, error: null },
      expectedOutput: { text: null, error: null },
    };
  }
  const [input, baselineOutput, expectedOutput] = await Promise.all([
    loadText(item.inputContentRef),
    loadText(item.baselineOutputContentRef),
    loadText(item.expectedOutputContentRef),
  ]);
  return { input, baselineOutput, expectedOutput };
}

async function loadText(contentId: string | null): Promise<TextContent> {
  if (contentId === null) {
    return { text: null, error: null };
  }
  try {
    return { text: await fetchContentText(contentId), error: null };
  } catch (error) {
    return {
      text: null,
      error: message(error, "Content unavailable"),
    };
  }
}

function displayText(content: TextContent): string {
  if (content.error !== null) {
    return content.error;
  }
  return content.text ?? "Not present";
}

function changeLabel(change: DatasetRevisionChangeKind): string {
  switch (change) {
    case "case_metadata":
      return "Case metadata";
    case "input_content":
      return "Input";
    case "baseline_output":
      return "Baseline output";
    case "expected_output":
      return "Expected output";
    case "expected_behavior":
      return "Expected behavior";
    case "tags":
      return "Tags";
  }
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
