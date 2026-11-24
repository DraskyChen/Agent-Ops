import {
  Activity,
  CircleX,
  Database,
  Eye,
  Inbox,
  RefreshCw,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  CandidateReason,
  TraceCandidate,
  TraceCandidateListResponse,
} from "@agent-ops/contracts";

import {
  dismissCandidate,
  fetchCandidates,
  restoreCandidate,
} from "./api.js";
import { TraceDatasetDialog } from "../traces/TraceDatasetDialog.js";
import {
  formatCost,
  formatDuration,
  formatTime,
} from "../traces/TracePrimitives.js";

type CandidateFilter =
  | "active"
  | CandidateReason
  | "dismissed";

export function CandidatesPage({
  canManage,
  onOpenTrace,
  onOpenDatasets,
}: {
  canManage: boolean;
  onOpenTrace: (traceId: string) => void;
  onOpenDatasets: () => void;
}) {
  const [data, setData] = useState<TraceCandidateListResponse | null>(null);
  const [filter, setFilter] = useState<CandidateFilter>("active");
  const [loading, setLoading] = useState(true);
  const [actionTraceId, setActionTraceId] = useState<string | null>(null);
  const [datasetTrace, setDatasetTrace] =
    useState<TraceCandidate | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setData(await fetchCandidates());
      setError(null);
    } catch (loadError) {
      setError(message(loadError, "Unable to load candidate traces"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const changeDecision = async (candidate: TraceCandidate) => {
    setActionTraceId(candidate.traceId);
    try {
      if (candidate.dismissedAt === null) {
        await dismissCandidate(candidate.traceId);
      } else {
        await restoreCandidate(candidate.traceId);
      }
      await load();
    } catch (actionError) {
      setError(
        message(actionError, "Unable to update candidate decision"),
      );
    } finally {
      setActionTraceId(null);
    }
  };

  const items = (data?.items ?? []).filter((candidate) =>
    matchesFilter(candidate, filter),
  );

  return (
    <div className="page candidate-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Data curation</p>
          <h1>Candidates</h1>
          <p>
            Review traces suggested by negative signals before deciding
            whether they belong in an evaluation dataset.
          </p>
        </div>
        <button
          className="button secondary compact"
          type="button"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={14} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="candidate-policy-note">
        <Inbox size={16} />
        <span>
          Candidates are suggestions. Nothing is copied into a dataset or
          evaluated until a user explicitly confirms it.
        </span>
      </div>

      {error === null ? null : (
        <div className="data-error" role="alert">
          <CircleX size={15} />
          {error}
        </div>
      )}

      <section className="candidate-summary">
        <Summary
          icon={<Inbox size={15} />}
          label="Active"
          value={data?.counts.active ?? 0}
        />
        <Summary
          icon={<Activity size={15} />}
          label="Negative feedback"
          value={data?.counts.negativeFeedback ?? 0}
        />
        <Summary
          icon={<Eye size={15} />}
          label="Review follow-up"
          value={data?.counts.reviewOpen ?? 0}
        />
        <Summary
          icon={<Database size={15} />}
          label="Evaluation failures"
          value={data?.counts.evaluationFailed ?? 0}
        />
      </section>

      <div className="candidate-filter-tabs" role="tablist">
        {(
          [
            ["active", "Active", data?.counts.active],
            [
              "negative_feedback",
              "Negative feedback",
              data?.counts.negativeFeedback,
            ],
            ["review_open", "Review follow-up", data?.counts.reviewOpen],
            ["runtime_failure", "Runtime failure", data?.counts.runtimeFailure],
            [
              "evaluation_failed",
              "Evaluation failed",
              data?.counts.evaluationFailed,
            ],
            [
              "evaluation_blocked",
              "Cannot evaluate",
              data?.counts.evaluationBlocked,
            ],
            ["dismissed", "Dismissed", data?.counts.dismissed],
          ] as Array<[CandidateFilter, string, number | undefined]>
        ).map(([value, label, count]) => (
          <button
            className={filter === value ? "active" : ""}
            type="button"
            key={value}
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
            <span>{count ?? 0}</span>
          </button>
        ))}
      </div>

      <section className="candidate-list">
        {loading && data === null ? (
          <div className="detail-loading">Loading candidate traces…</div>
        ) : items.length === 0 ? (
          <div className="candidate-empty">
            <Inbox size={22} />
            <strong>No candidates in this view</strong>
            <span>New negative signals will appear here for manual review.</span>
          </div>
        ) : (
          items.map((candidate) => (
            <article
              className={`candidate-card ${
                candidate.dismissedAt === null ? "" : "dismissed"
              }`}
              key={candidate.traceId}
            >
              <div className="candidate-main">
                <div className="candidate-heading">
                  <div>
                    <h2>{candidate.runName}</h2>
                    <code>{candidate.traceId}</code>
                  </div>
                  <span
                    className={`candidate-availability ${
                      candidate.datasetEligible ? "ready" : "blocked"
                    }`}
                  >
                    {candidate.datasetEligible
                      ? "Dataset ready"
                      : "Content unavailable"}
                  </span>
                </div>

                <div className="candidate-reasons">
                  {candidate.reasons.map((reason) => (
                    <span className={`candidate-reason ${reason}`} key={reason}>
                      {reasonLabel(reason)}
                    </span>
                  ))}
                  {candidate.datasetCount > 0 ? (
                    <span className="candidate-membership">
                      In {candidate.datasetCount} dataset
                      {candidate.datasetCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>

                <div className="candidate-metadata">
                  <span>{candidate.appName ?? "Unknown app"}</span>
                  <span>{candidate.promptVersion ?? "No prompt version"}</span>
                  <span>{candidate.environment ?? "unknown environment"}</span>
                  <span>{formatDuration(candidate.latencyMs ?? 0)}</span>
                  <span>{formatCost(candidate.costMicros ?? 0)}</span>
                  <span>
                    {candidate.startedAt === null
                      ? "unknown time"
                      : formatTime(candidate.startedAt)}
                  </span>
                </div>

                <div className="candidate-signal-detail">
                  {candidate.feedbackTypes.length === 0
                    ? null
                    : `Feedback: ${candidate.feedbackTypes.join(", ")}`}
                  {candidate.reviewIssueArea === null
                    ? null
                    : ` Review area: ${candidate.reviewIssueArea}.`}
                  {candidate.evaluationFailureCount === 0
                    ? null
                    : ` ${candidate.evaluationFailureCount} failed evaluation case${
                        candidate.evaluationFailureCount === 1 ? "" : "s"
                      }.`}
                  {candidate.evaluationBlockedCount === 0
                    ? null
                    : ` ${candidate.evaluationBlockedCount} blocked evaluation case${
                        candidate.evaluationBlockedCount === 1 ? "" : "s"
                      }.`}
                </div>
              </div>

              <div className="candidate-actions">
                <button
                  className="button secondary compact"
                  type="button"
                  onClick={() => onOpenTrace(candidate.traceId)}
                >
                  <Eye size={13} />
                  View trace
                </button>
                {canManage && candidate.datasetEligible &&
                candidate.dismissedAt === null ? (
                  <button
                    className="button primary compact"
                    type="button"
                    onClick={() => setDatasetTrace(candidate)}
                  >
                    <Database size={13} />
                    Add to dataset
                  </button>
                ) : null}
                {canManage ? (
                  <button
                    className="button secondary compact"
                    type="button"
                    onClick={() => void changeDecision(candidate)}
                    disabled={actionTraceId === candidate.traceId}
                  >
                    {candidate.dismissedAt === null ? (
                      <Trash2 size={13} />
                    ) : (
                      <RotateCcw size={13} />
                    )}
                    {actionTraceId === candidate.traceId
                      ? "Updating…"
                      : candidate.dismissedAt === null
                        ? "Dismiss"
                        : "Restore"}
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </section>

      {datasetTrace === null ? null : (
        <TraceDatasetDialog
          trace={{
            id: datasetTrace.traceId,
            runName: datasetTrace.runName,
            appName: datasetTrace.appName ?? "unknown",
            promptVersion: datasetTrace.promptVersion ?? "unknown",
            evalCaseId: datasetTrace.evalCaseId,
            ingestState: datasetTrace.ingestState,
          }}
          onClose={() => setDatasetTrace(null)}
          onOpenDatasets={onOpenDatasets}
        />
      )}
    </div>
  );
}

function Summary({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <div>
      <span>{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function matchesFilter(
  candidate: TraceCandidate,
  filter: CandidateFilter,
): boolean {
  if (filter === "dismissed") {
    return candidate.dismissedAt !== null;
  }
  if (candidate.dismissedAt !== null) {
    return false;
  }
  return filter === "active" || candidate.reasons.includes(filter);
}

function reasonLabel(reason: CandidateReason): string {
  switch (reason) {
    case "negative_feedback":
      return "Negative feedback";
    case "review_open":
      return "Review follow-up";
    case "runtime_failure":
      return "Runtime failure";
    case "evaluation_failed":
      return "Evaluation failed";
    case "evaluation_blocked":
      return "Cannot evaluate";
  }
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
