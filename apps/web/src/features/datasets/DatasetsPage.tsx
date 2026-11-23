import {
  CircleX,
  Database,
  FilePlus2,
  Layers3,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  DatasetDetail,
  DatasetRevisionDetail,
  DatasetSummary,
} from "@agent-ops/contracts";

import { Metric } from "../traces/TracePrimitives.js";
import {
  createDataset,
  createDatasetRevision,
  fetchDataset,
  fetchDatasetRevision,
  fetchDatasets,
} from "./api.js";

interface RevisionDraft {
  traceId: string;
  caseId: string;
  expectedOutput: string;
  expectedBehavior: string;
}

const EMPTY_ITEM: RevisionDraft = {
  traceId: "",
  caseId: "",
  expectedOutput: "",
  expectedBehavior: "",
};

export function DatasetsPage({
  canManage,
}: {
  canManage: boolean;
}) {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [revision, setRevision] =
    useState<DatasetRevisionDetail | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<RevisionDraft[]>([{ ...EMPTY_ITEM }]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadList = async (preferredId?: string) => {
    setLoading(true);
    try {
      const next = await fetchDatasets();
      setDatasets(next);
      const nextSelected =
        preferredId ??
        (selectedId !== null &&
        next.some((dataset) => dataset.datasetId === selectedId)
          ? selectedId
          : next[0]?.datasetId ?? null);
      setSelectedId(nextSelected);
      setError(null);
    } catch (loadError) {
      setError(message(loadError, "Unable to load datasets"));
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (datasetId: string) => {
    try {
      const nextDetail = await fetchDataset(datasetId);
      setDetail(nextDetail);
      const latest = nextDetail.revisions[0];
      setRevision(
        latest === undefined
          ? null
          : await fetchDatasetRevision(datasetId, latest.revisionId),
      );
      setError(null);
    } catch (loadError) {
      setDetail(null);
      setRevision(null);
      setError(message(loadError, "Unable to load dataset"));
    }
  };

  useEffect(() => {
    void loadList();
  }, []);

  useEffect(() => {
    if (selectedId !== null) {
      void loadDetail(selectedId);
    } else {
      setDetail(null);
      setRevision(null);
    }
  }, [selectedId]);

  const submitDataset = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const created = await createDataset({
        name,
        description,
      });
      setName("");
      setDescription("");
      await loadList(created.datasetId);
    } catch (submitError) {
      setError(message(submitError, "Unable to create dataset"));
    } finally {
      setSubmitting(false);
    }
  };

  const submitRevision = async (event: React.FormEvent) => {
    event.preventDefault();
    if (selectedId === null) {
      return;
    }
    setSubmitting(true);
    try {
      await createDatasetRevision(selectedId, {
        note,
        items: items.map((item) => ({
          traceId: item.traceId,
          ...(item.caseId.trim() === ""
            ? {}
            : { caseId: item.caseId }),
          ...(item.expectedOutput.trim() === ""
            ? {}
            : { expectedOutput: item.expectedOutput }),
          ...(item.expectedBehavior.trim() === ""
            ? {}
            : { expectedBehavior: item.expectedBehavior }),
        })),
      });
      setNote("");
      setItems([{ ...EMPTY_ITEM }]);
      await loadList(selectedId);
      await loadDetail(selectedId);
    } catch (submitError) {
      setError(message(submitError, "Unable to create dataset revision"));
    } finally {
      setSubmitting(false);
    }
  };

  const updateItem = (index: number, patch: Partial<RevisionDraft>) => {
    setItems((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  };

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Evaluation data</p>
          <h1>Datasets</h1>
          <p>
            Pin sealed traces into immutable revisions with durable content
            snapshots.
          </p>
        </div>
        <button
          className="button secondary compact"
          type="button"
          onClick={() => void loadList()}
          disabled={loading}
        >
          <RefreshCw size={14} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error === null ? null : (
        <div className="data-error" role="alert">
          <CircleX size={15} />
          {error}
        </div>
      )}

      <section className="metrics-strip evaluation-kpis">
        <Metric
          icon={<Database size={16} />}
          label="Datasets"
          value={datasets.length.toLocaleString()}
          detail="versioned test collections"
        />
        <Metric
          icon={<Layers3 size={16} />}
          label="Revisions"
          value={(detail?.revisions.length ?? 0).toLocaleString()}
          detail="selected dataset"
        />
        <Metric
          icon={<FilePlus2 size={16} />}
          label="Latest cases"
          value={(revision?.items.length ?? 0).toLocaleString()}
          detail={
            revision === null ? "no revision yet" : `revision ${revision.revision}`
          }
        />
      </section>

      <section className="entity-layout">
        <aside className="entity-sidebar">
          <div className="panel-heading">
            <div>
              <strong>Collections</strong>
              <small>Select a dataset to inspect its revisions</small>
            </div>
          </div>
          <div className="entity-list">
            {datasets.length === 0 ? (
              <p className="empty-copy">No datasets have been created.</p>
            ) : (
              datasets.map((dataset) => (
                <button
                  className={`entity-list-item ${
                    dataset.datasetId === selectedId ? "active" : ""
                  }`}
                  type="button"
                  key={dataset.datasetId}
                  onClick={() => setSelectedId(dataset.datasetId)}
                >
                  <span>
                    <strong>{dataset.name}</strong>
                    <small>
                      {dataset.latestRevision === null
                        ? "No revision"
                        : `Revision ${dataset.latestRevision}`}{" "}
                      · {dataset.itemCount} cases
                    </small>
                  </span>
                  <Layers3 size={14} />
                </button>
              ))
            )}
          </div>

          {canManage ? (
            <form className="entity-form compact-form" onSubmit={submitDataset}>
              <div className="form-heading">
                <strong>New dataset</strong>
                <small>Create a container for immutable revisions</small>
              </div>
              <Field label="Name">
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={120}
                />
              </Field>
              <Field label="Description">
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={2000}
                  rows={2}
                />
              </Field>
              <button
                className="button primary compact"
                type="submit"
                disabled={submitting || name.trim() === ""}
              >
                <Plus size={14} />
                Create dataset
              </button>
            </form>
          ) : (
            <p className="permission-note">
              Reviewer access is required to create datasets.
            </p>
          )}
        </aside>

        <div className="entity-main">
          {detail === null ? (
            <div className="entity-empty">
              <Database size={22} />
              <strong>Select or create a dataset</strong>
              <span>Dataset revisions keep evaluation inputs stable.</span>
            </div>
          ) : (
            <>
              <div className="entity-header">
                <div>
                  <p className="eyebrow">Dataset</p>
                  <h2>{detail.name}</h2>
                  <p>{detail.description ?? "No description"}</p>
                </div>
                <span className="demo-badge">
                  {detail.revisions.length} revisions
                </span>
              </div>

              {canManage ? (
                <form
                  className="entity-form revision-form"
                  onSubmit={submitRevision}
                >
                  <div className="form-heading">
                    <strong>Create immutable revision</strong>
                    <small>
                      Traces must be sealed and contain captured input/output
                    </small>
                  </div>
                  <Field label="Revision note">
                    <input
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Baseline refund cases"
                    />
                  </Field>

                  <div className="revision-items">
                    {items.map((item, index) => (
                      <div className="revision-item" key={index}>
                        <div className="revision-item-heading">
                          <strong>Case {index + 1}</strong>
                          {items.length > 1 ? (
                            <button
                              className="icon-button"
                              type="button"
                              aria-label={`Remove case ${index + 1}`}
                              onClick={() =>
                                setItems((current) =>
                                  current.filter(
                                    (_entry, itemIndex) =>
                                      itemIndex !== index,
                                  ),
                                )
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          ) : null}
                        </div>
                        <div className="revision-item-grid">
                          <Field label="Trace ID">
                            <input
                              value={item.traceId}
                              onChange={(event) =>
                                updateItem(index, {
                                  traceId: event.target.value,
                                })
                              }
                              required
                            />
                          </Field>
                          <Field label="Case ID">
                            <input
                              value={item.caseId}
                              onChange={(event) =>
                                updateItem(index, {
                                  caseId: event.target.value,
                                })
                              }
                              placeholder="Uses trace case ID when empty"
                            />
                          </Field>
                          <Field label="Expected output">
                            <textarea
                              value={item.expectedOutput}
                              onChange={(event) =>
                                updateItem(index, {
                                  expectedOutput: event.target.value,
                                })
                              }
                              rows={2}
                            />
                          </Field>
                          <Field label="Expected behavior">
                            <textarea
                              value={item.expectedBehavior}
                              onChange={(event) =>
                                updateItem(index, {
                                  expectedBehavior: event.target.value,
                                })
                              }
                              rows={2}
                            />
                          </Field>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="form-actions">
                    <button
                      className="button secondary compact"
                      type="button"
                      onClick={() =>
                        setItems((current) => [
                          ...current,
                          { ...EMPTY_ITEM },
                        ])
                      }
                    >
                      <Plus size={14} />
                      Add case
                    </button>
                    <button
                      className="button primary compact"
                      type="submit"
                      disabled={
                        submitting ||
                        items.some((item) => item.traceId.trim() === "")
                      }
                    >
                      Create revision
                    </button>
                  </div>
                </form>
              ) : null}

              <section className="entity-table">
                <div className="panel-heading">
                  <div>
                    <strong>Latest revision items</strong>
                    <small>
                      {revision === null
                        ? "No revision"
                        : `Revision ${revision.revision} · ${revision.items.length} cases`}
                    </small>
                  </div>
                </div>
                {revision === null ? (
                  <p className="empty-copy">
                    Add sealed traces to create the first revision.
                  </p>
                ) : (
                  <div className="case-list">
                    {revision.items.map((item) => (
                      <article key={item.itemId}>
                        <div>
                          <strong>{item.caseId}</strong>
                          <small>
                            {item.appName ?? "Unknown app"} ·{" "}
                            {item.promptVersion ?? "No prompt version"}
                          </small>
                        </div>
                        <code>{item.sourceTraceId}</code>
                        <span>
                          {item.expectedOutputContentRef === null
                            ? "Behavior only"
                            : "Expected output"}
                        </span>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="entity-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
