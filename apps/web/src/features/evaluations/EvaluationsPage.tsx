import {
  CircleCheck,
  CircleX,
  Clock3,
  FlaskConical,
  ListChecks,
  Play,
  RefreshCw,
  Square,
  Target,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  DatasetDetail,
  DatasetSummary,
  EvaluationDetail,
  EvaluationStatus,
  EvaluationSummary,
  RuleEvaluatorDefinition,
} from "@agent-ops/contracts";

import { fetchDataset, fetchDatasets } from "../datasets/api.js";
import { Metric } from "../traces/TracePrimitives.js";
import {
  cancelEvaluation,
  createEvaluation,
  fetchEvaluation,
  fetchEvaluations,
} from "./api.js";

const EVALUATOR_OPTIONS: Array<{
  value: RuleEvaluatorDefinition["kind"];
  label: string;
}> = [
  { value: "exact", label: "Exact output" },
  { value: "contains", label: "Contains text" },
  { value: "regex", label: "Regular expression" },
  { value: "json_valid", label: "Valid JSON" },
  { value: "max_latency_ms", label: "Maximum latency" },
  { value: "max_cost_micros", label: "Maximum cost" },
  { value: "max_tool_errors", label: "Maximum tool errors" },
];

export function EvaluationsPage({
  canManage,
}: {
  canManage: boolean;
}) {
  const [evaluations, setEvaluations] = useState<EvaluationSummary[]>([]);
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EvaluationDetail | null>(null);
  const [datasetDetail, setDatasetDetail] = useState<DatasetDetail | null>(
    null,
  );
  const [datasetId, setDatasetId] = useState("");
  const [revisionId, setRevisionId] = useState("");
  const [evaluatorName, setEvaluatorName] = useState("output-rule");
  const [evaluatorVersion, setEvaluatorVersion] = useState("1");
  const [evaluatorKind, setEvaluatorKind] =
    useState<RuleEvaluatorDefinition["kind"]>("exact");
  const [configValue, setConfigValue] = useState("");
  const [appName, setAppName] = useState("");
  const [promptVersion, setPromptVersion] = useState("");
  const [environment, setEnvironment] = useState("test");
  const [timeRange, setTimeRange] = useState("24");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadEvaluations = async (preferredId?: string) => {
    setLoading(true);
    try {
      const next = await fetchEvaluations();
      setEvaluations(next);
      const nextSelected =
        preferredId ??
        (selectedId !== null &&
        next.some((evaluation) => evaluation.evaluationId === selectedId)
          ? selectedId
          : next[0]?.evaluationId ?? null);
      setSelectedId(nextSelected);
      setError(null);
    } catch (loadError) {
      setError(message(loadError, "Unable to load evaluations"));
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (evaluationId: string) => {
    try {
      setDetail(await fetchEvaluation(evaluationId));
      setError(null);
    } catch (loadError) {
      setDetail(null);
      setError(message(loadError, "Unable to load evaluation"));
    }
  };

  useEffect(() => {
    void Promise.all([
      loadEvaluations(),
      fetchDatasets()
        .then((next) => {
          setDatasets(next);
          if (next[0] !== undefined) {
            setDatasetId(next[0].datasetId);
          }
        })
        .catch((loadError: unknown) => {
          setError(message(loadError, "Unable to load datasets"));
        }),
    ]);
  }, []);

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    void loadDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (
      selectedId === null ||
      (detail?.status !== "queued" && detail?.status !== "running")
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadDetail(selectedId);
      void loadEvaluations(selectedId);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [detail?.status, selectedId]);

  useEffect(() => {
    if (datasetId === "") {
      setDatasetDetail(null);
      setRevisionId("");
      return;
    }
    void fetchDataset(datasetId)
      .then((next) => {
        setDatasetDetail(next);
        setRevisionId(next.revisions[0]?.revisionId ?? "");
      })
      .catch((loadError: unknown) => {
        setError(message(loadError, "Unable to load dataset revisions"));
      });
  }, [datasetId]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (revisionId === "") {
      setError("Create a dataset revision before starting an evaluation.");
      return;
    }
    setSubmitting(true);
    try {
      const evaluator = evaluatorFromForm({
        name: evaluatorName,
        version: evaluatorVersion,
        kind: evaluatorKind,
        configValue,
      });
      const hours = Number(timeRange);
      const now = new Date();
      const created = await createEvaluation({
        datasetRevisionId: revisionId,
        evaluator,
        traceSelector: {
          ...(appName.trim() === "" ? {} : { appName: appName.trim() }),
          ...(promptVersion.trim() === ""
            ? {}
            : { promptVersion: promptVersion.trim() }),
          ...(environment === "all"
            ? {}
            : {
                environment: environment as "prod" | "staging" | "dev" | "test",
              }),
          startedAfter: new Date(
            now.getTime() - hours * 60 * 60 * 1000,
          ).toISOString(),
          startedBefore: now.toISOString(),
        },
      });
      await loadEvaluations(created.evaluationId);
      setSelectedId(created.evaluationId);
      setError(null);
    } catch (submitError) {
      setError(message(submitError, "Unable to create evaluation"));
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (selectedId === null) {
      return;
    }
    try {
      setDetail(await cancelEvaluation(selectedId));
      await loadEvaluations(selectedId);
    } catch (cancelError) {
      setError(message(cancelError, "Unable to cancel evaluation"));
    }
  };

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Quality loop</p>
          <h1>Evaluations</h1>
          <p>
            Match candidate traces by case ID and score them with deterministic
            evaluators.
          </p>
        </div>
        <button
          className="button secondary compact"
          type="button"
          onClick={() => void loadEvaluations()}
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
          icon={<FlaskConical size={16} />}
          label="Evaluation runs"
          value={evaluations.length.toLocaleString()}
          detail="newest first"
        />
        <Metric
          icon={<Target size={16} />}
          label="Pass rate"
          value={percentage(detail)}
          detail="selected run"
        />
        <Metric
          icon={<ListChecks size={16} />}
          label="Coverage"
          value={coverage(detail)}
          detail="matched and scored"
        />
      </section>

      <section className="entity-layout">
        <aside className="entity-sidebar">
          <div className="panel-heading">
            <div>
              <strong>Runs</strong>
              <small>Queued, running, and completed evaluations</small>
            </div>
          </div>
          <div className="entity-list">
            {evaluations.length === 0 ? (
              <p className="empty-copy">No evaluations have been started.</p>
            ) : (
              evaluations.map((evaluation) => (
                <button
                  className={`entity-list-item ${
                    evaluation.evaluationId === selectedId ? "active" : ""
                  }`}
                  type="button"
                  key={evaluation.evaluationId}
                  onClick={() => setSelectedId(evaluation.evaluationId)}
                >
                  <span>
                    <strong>{evaluation.evaluatorName}</strong>
                    <small>
                      {evaluation.datasetName} · {evaluation.passedCases}/
                      {evaluation.scoredCases} passed
                    </small>
                  </span>
                  <StatusBadge status={evaluation.status} />
                </button>
              ))
            )}
          </div>

          {canManage ? (
            <form className="entity-form compact-form" onSubmit={submit}>
              <div className="form-heading">
                <strong>Run evaluation</strong>
                <small>Candidate traces must carry a matching case ID</small>
              </div>
              <Field label="Dataset">
                <select
                  value={datasetId}
                  onChange={(event) => setDatasetId(event.target.value)}
                  required
                >
                  <option value="">Select dataset</option>
                  {datasets.map((dataset) => (
                    <option key={dataset.datasetId} value={dataset.datasetId}>
                      {dataset.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Revision">
                <select
                  value={revisionId}
                  onChange={(event) => setRevisionId(event.target.value)}
                  required
                >
                  {(datasetDetail?.revisions ?? []).map((revision) => (
                    <option key={revision.revisionId} value={revision.revisionId}>
                      Revision {revision.revision} · {revision.itemCount} cases
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Evaluator name">
                <input
                  value={evaluatorName}
                  onChange={(event) => setEvaluatorName(event.target.value)}
                  required
                />
              </Field>
              <div className="entity-form-row">
                <Field label="Version">
                  <input
                    type="number"
                    min={1}
                    value={evaluatorVersion}
                    onChange={(event) =>
                      setEvaluatorVersion(event.target.value)
                    }
                    required
                  />
                </Field>
                <Field label="Rule">
                  <select
                    value={evaluatorKind}
                    onChange={(event) =>
                      setEvaluatorKind(
                        event.target.value as RuleEvaluatorDefinition["kind"],
                      )
                    }
                  >
                    {EVALUATOR_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              {evaluatorKind === "contains" ||
              evaluatorKind === "regex" ||
              evaluatorKind === "max_latency_ms" ||
              evaluatorKind === "max_cost_micros" ||
              evaluatorKind === "max_tool_errors" ? (
                <Field
                  label={
                    evaluatorKind === "regex"
                      ? "Pattern"
                      : evaluatorKind === "contains"
                        ? "Required text"
                        : "Threshold"
                  }
                >
                  <input
                    value={configValue}
                    onChange={(event) => setConfigValue(event.target.value)}
                    required
                  />
                </Field>
              ) : null}
              <div className="entity-form-row">
                <Field label="Application">
                  <input
                    value={appName}
                    onChange={(event) => setAppName(event.target.value)}
                    placeholder="Any application"
                  />
                </Field>
                <Field label="Prompt version">
                  <input
                    value={promptVersion}
                    onChange={(event) => setPromptVersion(event.target.value)}
                    placeholder="Candidate version"
                  />
                </Field>
              </div>
              <div className="entity-form-row">
                <Field label="Environment">
                  <select
                    value={environment}
                    onChange={(event) => setEnvironment(event.target.value)}
                  >
                    <option value="all">All environments</option>
                    <option value="test">Test</option>
                    <option value="dev">Development</option>
                    <option value="staging">Staging</option>
                    <option value="prod">Production</option>
                  </select>
                </Field>
                <Field label="Time window">
                  <select
                    value={timeRange}
                    onChange={(event) => setTimeRange(event.target.value)}
                  >
                    <option value="24">Last 24 hours</option>
                    <option value="168">Last 7 days</option>
                    <option value="720">Last 30 days</option>
                  </select>
                </Field>
              </div>
              <button
                className="button primary compact"
                type="submit"
                disabled={submitting || revisionId === ""}
              >
                <Play size={14} />
                Start evaluation
              </button>
            </form>
          ) : (
            <p className="permission-note">
              Reviewer access is required to start evaluations.
            </p>
          )}
        </aside>

        <div className="entity-main">
          {detail === null ? (
            <div className="entity-empty">
              <FlaskConical size={22} />
              <strong>Select an evaluation run</strong>
              <span>Results include coverage, score, and per-case reasons.</span>
            </div>
          ) : (
            <>
              <div className="entity-header">
                <div>
                  <p className="eyebrow">Evaluation</p>
                  <h2>{detail.evaluatorName}</h2>
                  <p>
                    {detail.datasetName} · revision {detail.datasetRevision} ·{" "}
                    {detail.evaluatorKind}
                  </p>
                </div>
                <StatusBadge status={detail.status} />
              </div>

              <div className="evaluation-summary-grid">
                <SummaryValue
                  label="Passed"
                  value={`${detail.passedCases}/${detail.scoredCases}`}
                />
                <SummaryValue
                  label="Average score"
                  value={
                    detail.averageScore === null
                      ? "—"
                      : detail.averageScore.toFixed(2)
                  }
                />
                <SummaryValue
                  label="Missing"
                  value={detail.missingCases.toLocaleString()}
                />
                <SummaryValue
                  label="Unscorable"
                  value={detail.unscorableCases.toLocaleString()}
                />
                <SummaryValue
                  label="Errors"
                  value={detail.erroredCases.toLocaleString()}
                />
              </div>

              {detail.status === "queued" || detail.status === "running" ? (
                <div className="evaluation-progress">
                  <Clock3 size={15} />
                  Worker is processing {detail.totalCases} cases.
                  <button
                    className="button secondary compact"
                    type="button"
                    onClick={() => void cancel()}
                  >
                    <Square size={12} />
                    Cancel
                  </button>
                </div>
              ) : null}

              <section className="entity-table">
                <div className="panel-heading">
                  <div>
                    <strong>Case results</strong>
                    <small>
                      {detail.cases.length} dataset cases · candidate{" "}
                      {detail.traceSelector.promptVersion ?? "any prompt"}
                    </small>
                  </div>
                </div>
                <div className="case-list evaluation-case-list">
                  {detail.cases.map((evaluationCase) => (
                    <article key={evaluationCase.evaluationCaseId}>
                      <div>
                        <strong>{evaluationCase.caseId}</strong>
                        <small>
                          {evaluationCase.candidateTraceId ??
                            "No matching candidate trace"}
                        </small>
                      </div>
                      <StatusBadge status={evaluationCase.status} />
                      <span>
                        {evaluationCase.reason ??
                          evaluationCase.error ??
                          "Waiting for result"}
                      </span>
                      <strong>
                        {evaluationCase.score === null
                          ? "—"
                          : evaluationCase.score.toFixed(2)}
                      </strong>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function evaluatorFromForm({
  name,
  version,
  kind,
  configValue,
}: {
  name: string;
  version: string;
  kind: RuleEvaluatorDefinition["kind"];
  configValue: string;
}): RuleEvaluatorDefinition {
  const base = {
    name: name.trim(),
    version: Number(version),
  };
  switch (kind) {
    case "exact":
      return { ...base, kind, config: {} };
    case "contains":
      return { ...base, kind, config: { value: configValue } };
    case "regex":
      return { ...base, kind, config: { pattern: configValue } };
    case "json_valid":
      return { ...base, kind, config: {} };
    case "max_latency_ms":
    case "max_cost_micros":
    case "max_tool_errors":
      return { ...base, kind, config: { value: Number(configValue) } };
  }
}

function StatusBadge({
  status,
}: {
  status: EvaluationStatus | EvaluationDetail["cases"][number]["status"];
}) {
  return (
    <span className={`evaluation-status ${status}`}>
      {status.replace("_", " ")}
    </span>
  );
}

function SummaryValue({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
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

function percentage(detail: EvaluationDetail | null): string {
  if (detail === null || detail.scoredCases === 0) {
    return "—";
  }
  return `${Math.round((detail.passedCases / detail.scoredCases) * 100)}%`;
}

function coverage(detail: EvaluationDetail | null): string {
  if (detail === null || detail.totalCases === 0) {
    return "—";
  }
  return `${Math.round((detail.scoredCases / detail.totalCases) * 100)}%`;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
