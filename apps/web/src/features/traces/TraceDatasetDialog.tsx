import {
  CircleCheck,
  CircleX,
  Database,
  Layers3,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  DatasetRevisionDetail,
  DatasetSummary,
} from "@agent-ops/contracts";

import {
  createDatasetRevision,
  fetchDatasets,
} from "../datasets/api.js";
import type { TraceView } from "./model.js";

export type DatasetTraceTarget = Pick<
  TraceView,
  | "id"
  | "runName"
  | "appName"
  | "promptVersion"
  | "evalCaseId"
  | "ingestState"
>;

export function TraceDatasetDialog({
  trace,
  onClose,
  onOpenDatasets,
}: {
  trace: DatasetTraceTarget;
  onClose: () => void;
  onOpenDatasets: () => void;
}) {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [caseId, setCaseId] = useState(trace.evalCaseId ?? "");
  const [note, setNote] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");
  const [expectedBehavior, setExpectedBehavior] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<DatasetRevisionDetail | null>(null);

  useEffect(() => {
    let active = true;
    fetchDatasets()
      .then((next) => {
        if (!active) {
          return;
        }
        setDatasets(next);
        setDatasetId(next[0]?.datasetId ?? "");
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(message(loadError, "Unable to load datasets"));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !submitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, submitting]);

  const eligible = trace.ingestState === "sealed_complete";
  const canSubmit =
    eligible &&
    !loading &&
    !submitting &&
    datasetId !== "" &&
    caseId.trim() !== "" &&
    confirmed;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    setSubmitting(true);
    try {
      const revision = await createDatasetRevision(datasetId, {
        ...(note.trim() === "" ? {} : { note: note.trim() }),
        items: [
          {
            traceId: trace.id,
            caseId: caseId.trim(),
            ...(expectedOutput.trim() === ""
              ? {}
              : { expectedOutput }),
            ...(expectedBehavior.trim() === ""
              ? {}
              : { expectedBehavior: expectedBehavior.trim() }),
          },
        ],
      });
      setCreated(revision);
      setError(null);
    } catch (submitError) {
      setError(message(submitError, "Unable to add trace to dataset"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="dataset-dialog-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !submitting) {
          onClose();
        }
      }}
    >
      <section
        className="dataset-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dataset-dialog-title"
      >
        <header className="dataset-dialog-header">
          <div>
            <span className="dataset-dialog-icon">
              <Database size={17} />
            </span>
            <div>
              <h2 id="dataset-dialog-title">Add trace to dataset</h2>
              <p>Create a new immutable revision from this selected trace.</p>
            </div>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close add-to-dataset dialog"
            onClick={onClose}
            disabled={submitting}
          >
            <X size={16} />
          </button>
        </header>

        {created === null ? (
          <form className="dataset-dialog-body" onSubmit={(event) => void submit(event)}>
            <div className="dialog-trace-summary">
              <div>
                <span>Selected trace</span>
                <strong>{trace.runName}</strong>
                <code>{trace.id}</code>
              </div>
              <div>
                <span>Application</span>
                <strong>{trace.appName}</strong>
                <small>{trace.promptVersion}</small>
              </div>
              <div>
                <span>Ingest state</span>
                <strong>{trace.ingestState.replaceAll("_", " ")}</strong>
                <small>
                  {eligible
                    ? "Eligible for immutable snapshots"
                    : "Trace must be sealed before it can be added"}
                </small>
              </div>
            </div>

            {error === null ? null : (
              <div className="data-error" role="alert">
                <CircleX size={15} />
                {error}
              </div>
            )}

            {loading ? (
              <p className="empty-copy">Loading datasets…</p>
            ) : datasets.length === 0 ? (
              <div className="dataset-dialog-empty">
                <Layers3 size={20} />
                <strong>No dataset is available</strong>
                <span>Create a dataset first, then return to this trace.</span>
                <button
                  className="button primary compact"
                  type="button"
                  onClick={onOpenDatasets}
                >
                  Open Datasets
                </button>
              </div>
            ) : (
              <>
                <label className="entity-field">
                  <span>Dataset</span>
                  <select
                    value={datasetId}
                    onChange={(event) => setDatasetId(event.target.value)}
                    required
                  >
                    {datasets.map((dataset) => (
                      <option key={dataset.datasetId} value={dataset.datasetId}>
                        {dataset.name} · {dataset.latestRevision === null
                          ? "no revisions"
                          : `revision ${dataset.latestRevision}`}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="entity-form-row">
                  <label className="entity-field">
                    <span>Case ID</span>
                    <input
                      value={caseId}
                      onChange={(event) => setCaseId(event.target.value)}
                      placeholder="refund-case-001"
                      maxLength={128}
                      required
                    />
                  </label>
                  <label className="entity-field">
                    <span>Revision note</span>
                    <input
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Added from operational review"
                      maxLength={2000}
                    />
                  </label>
                </div>

                <label className="entity-field">
                  <span>Expected output</span>
                  <textarea
                    value={expectedOutput}
                    onChange={(event) => setExpectedOutput(event.target.value)}
                    placeholder="Optional expected answer for exact and judge evaluations"
                    rows={3}
                  />
                </label>

                <label className="entity-field">
                  <span>Expected behavior</span>
                  <textarea
                    value={expectedBehavior}
                    onChange={(event) => setExpectedBehavior(event.target.value)}
                    placeholder="Optional rules the candidate should follow"
                    rows={3}
                  />
                </label>

                <div className="dataset-snapshot-note">
                  <Database size={15} />
                  <span>
                    The captured trace input and baseline output will be copied
                    into a new dataset revision. Existing revisions are never
                    changed automatically.
                  </span>
                </div>

                <label className="judge-consent">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    disabled={!eligible}
                  />
                  <span>
                    I confirm this trace should be included as evaluation data.
                  </span>
                </label>

                <div className="form-actions">
                  <button
                    className="button secondary compact"
                    type="button"
                    onClick={onClose}
                    disabled={submitting}
                  >
                    Cancel
                  </button>
                  <button
                    className="button primary compact"
                    type="submit"
                    disabled={!canSubmit}
                  >
                    {submitting ? "Adding…" : "Create dataset revision"}
                  </button>
                </div>
              </>
            )}
          </form>
        ) : (
          <div className="dataset-dialog-success" aria-live="polite">
            <CircleCheck size={24} />
            <strong>Trace added to dataset revision {created.revision}</strong>
            <span>
              The new revision contains {created.itemCount} case
              {created.itemCount === 1 ? "" : "s"}. The original trace was not
              modified.
            </span>
            <div className="form-actions">
              <button
                className="button secondary compact"
                type="button"
                onClick={onClose}
              >
                Close
              </button>
              <button
                className="button primary compact"
                type="button"
                onClick={onOpenDatasets}
              >
                Open Datasets
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
