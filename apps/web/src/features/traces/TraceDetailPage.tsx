import {
  Activity,
  ArrowLeft,
  Braces,
  ClipboardCheck,
  Gauge,
  Timer,
} from "lucide-react";
import { useState } from "react";

import type {
  MeResponse,
  ReviewIssueArea,
  ReviewStatus,
} from "@agent-ops/contracts";

import type {
  InspectorTab,
  ReviewInput,
  TraceSpanView,
  TraceView,
} from "./model.js";
import {
  formatCost,
  formatDuration,
  MetadataGrid,
  MetaItem,
  Metric,
  spanTypeLabel,
  SpanTypeIcon,
  StatusBadge,
} from "./TracePrimitives.js";

export function TraceDetailPage({
  trace,
  selectedSpan,
  inspectorTab,
  onSelectSpan,
  onInspectorTab,
  onBack,
  me,
  reviewSubmitting,
  onSubmitReview,
  error,
}: {
  trace: TraceView;
  selectedSpan: TraceSpanView | null;
  inspectorTab: InspectorTab;
  onSelectSpan: (span: TraceSpanView) => void;
  onInspectorTab: (tab: InspectorTab) => void;
  onBack: () => void;
  me: MeResponse;
  reviewSubmitting: boolean;
  onSubmitReview: (input: ReviewInput) => Promise<void>;
  error: string | null;
}) {
  return (
    <div className="trace-detail-page">
      <div className="detail-heading">
        <div className="detail-title-row">
          <button
            className="icon-button back-button"
            type="button"
            aria-label="Back to traces"
            onClick={onBack}
          >
            <ArrowLeft size={17} />
          </button>
          <div>
            <div className="detail-title-line">
              <h1>{trace.runName}</h1>
              <StatusBadge status={trace.status} />
            </div>
            <div className="trace-identity">
              <code className="trace-id">{trace.id}</code>
              <span className={`ingest-state ${trace.ingestState}`}>
                {ingestStateLabel(trace.ingestState)}
              </span>
            </div>
          </div>
        </div>
        <div className="detail-metadata">
          <MetaItem label="App" value={trace.appName} />
          <MetaItem label="Task" value={trace.taskType} />
          <MetaItem label="Model" value={trace.model} />
          <MetaItem label="Prompt" value={trace.promptVersion} />
          <MetaItem label="Service" value={trace.serviceVersion} />
          <MetaItem label="Environment" value={trace.environment} />
          <MetaItem label="Session" value={trace.sessionId} />
        </div>
      </div>

      {error === null ? null : (
        <div className="data-error detail-error" role="alert">
          {error}
        </div>
      )}

      <section className="trace-kpis">
        <Metric
          icon={<Timer size={16} />}
          label="Duration"
          value={formatDuration(trace.latencyMs)}
          detail={`${trace.stepCount} steps`}
        />
        <Metric
          icon={<Gauge size={16} />}
          label="Cost"
          value={formatCost(trace.costMicros)}
          detail="total run cost"
        />
        <Metric
          icon={<Braces size={16} />}
          label="Input tokens"
          value={trace.inputTokens.toLocaleString()}
          detail="all LLM calls"
        />
        <Metric
          icon={<Activity size={16} />}
          label="Output tokens"
          value={trace.outputTokens.toLocaleString()}
          detail="all LLM calls"
        />
      </section>

      <section className="trace-inspector">
        <div className="span-tree-panel">
          <div className="panel-heading">
            <div>
              <strong>Execution tree</strong>
              <small>{trace.spans.length} spans</small>
            </div>
            <button className="button secondary compact" type="button" disabled>
              Waterfall
            </button>
          </div>
          <div className="span-tree">
            {trace.spans.map((span) => (
              <button
                className={`span-row ${selectedSpan?.id === span.id ? "selected" : ""}`}
                key={span.id}
                type="button"
                onClick={() => onSelectSpan(span)}
                style={{ paddingLeft: `${18 + span.depth * 22}px` }}
              >
                <span className={`span-icon ${span.type}`}>
                  <SpanTypeIcon type={span.type} />
                </span>
                <span className="span-name">
                  <strong>{span.name}</strong>
                  <small>{spanTypeLabel(span.type)}</small>
                </span>
                <span className="span-stats">
                  <code>{formatDuration(span.latencyMs)}</code>
                  {span.inputTokens !== undefined ? (
                    <small>
                      {span.inputTokens.toLocaleString()} →{" "}
                      {span.outputTokens?.toLocaleString()}
                    </small>
                  ) : null}
                </span>
                {span.status !== "ok" ? (
                  <span className={`span-status ${span.status}`} />
                ) : null}
              </button>
            ))}
          </div>
        </div>

        <div className="span-detail-panel">
          {selectedSpan === null ? (
            <div className="inspector-empty">Select a span to inspect its content.</div>
          ) : (
            <>
              <div className="panel-heading span-detail-heading">
                <div>
                  <span className={`span-icon ${selectedSpan.type}`}>
                    <SpanTypeIcon type={selectedSpan.type} />
                  </span>
                  <div>
                    <strong>{selectedSpan.name}</strong>
                    <small>
                      {spanTypeLabel(selectedSpan.type)} ·{" "}
                      {formatDuration(selectedSpan.latencyMs)}
                    </small>
                  </div>
                </div>
                <span className={`status-badge ${selectedSpan.status}`}>
                  {selectedSpan.status === "ok" ? "OK" : selectedSpan.status}
                </span>
              </div>

              <div className="inspector-tabs" role="tablist">
                {(["input", "output", "metadata"] as const).map((tab) => (
                  <button
                    className={inspectorTab === tab ? "active" : ""}
                    key={tab}
                    type="button"
                    role="tab"
                    aria-selected={inspectorTab === tab}
                    onClick={() => onInspectorTab(tab)}
                  >
                    {tabLabel(tab)}
                  </button>
                ))}
              </div>

              <div className="inspector-content">
                {inspectorTab === "metadata" ? (
                  <MetadataGrid metadata={selectedSpan.metadata} />
                ) : (
                  <pre>
                    {inspectorTab === "input"
                      ? selectedSpan.input
                      : selectedSpan.output}
                  </pre>
                )}
              </div>
            </>
          )}
        </div>
      </section>

      <ReviewPanel
        trace={trace}
        me={me}
        submitting={reviewSubmitting}
        onSubmit={onSubmitReview}
      />
    </div>
  );
}

function ReviewPanel({
  trace,
  me,
  submitting,
  onSubmit,
}: {
  trace: TraceView;
  me: MeResponse;
  submitting: boolean;
  onSubmit: (input: ReviewInput) => Promise<void>;
}) {
  const [status, setStatus] = useState<ReviewStatus>("open");
  const [issueArea, setIssueArea] = useState<ReviewIssueArea | "">("");
  const [comment, setComment] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await onSubmit({
      status,
      ...(issueArea === "" ? {} : { issueArea }),
      ...(comment.trim() === "" ? {} : { comment: comment.trim() }),
    });
    setComment("");
  };

  return (
    <section className="review-panel">
      <div className="review-panel-main">
        <div className="panel-heading">
          <div>
            <span className="review-heading-icon">
              <ClipboardCheck size={17} />
            </span>
            <div>
              <strong>Operational review</strong>
              <small>Append a durable reviewer decision to this trace.</small>
            </div>
          </div>
          <span className={`review-state ${trace.reviewStatus}`}>
            {reviewStateLabel(trace.reviewStatus)}
          </span>
        </div>

        {me.canReview ? (
          <form className="review-form" onSubmit={(event) => void submit(event)}>
            <label>
              <span>Decision</span>
              <select
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as ReviewStatus)
                }
              >
                <option value="open">Needs follow-up</option>
                <option value="resolved">Resolved</option>
                <option value="ignored">Ignored</option>
              </select>
            </label>
            <label>
              <span>Issue area</span>
              <select
                value={issueArea}
                onChange={(event) =>
                  setIssueArea(event.target.value as ReviewIssueArea | "")
                }
              >
                <option value="">Unclassified</option>
                <option value="prompt">Prompt</option>
                <option value="model">Model</option>
                <option value="tool">Tool</option>
                <option value="retrieval">Retrieval</option>
                <option value="data">Data</option>
                <option value="infrastructure">Infrastructure</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="review-comment">
              <span>Reviewer note</span>
              <textarea
                value={comment}
                maxLength={4000}
                rows={3}
                onChange={(event) => setComment(event.target.value)}
                placeholder="What happened, and what should happen next?"
              />
            </label>
            <button
              className="button primary compact"
              type="submit"
              disabled={submitting}
            >
              {submitting ? "Saving…" : "Record review"}
            </button>
          </form>
        ) : (
          <p className="permission-note">
            Reviewer permission is required to record a decision.
          </p>
        )}
      </div>

      <div className="review-history">
        <h2>Activity</h2>
        {trace.reviews.length > 0 ? (
          <div className="review-list">
            {trace.reviews.map((review) => (
              <article key={review.reviewId}>
                <div>
                  <strong>{review.reviewerName}</strong>
                  <span>{formatTimestamp(review.createdAt)}</span>
                </div>
                <p>
                  <span className={`review-state ${review.status}`}>
                    {reviewStateLabel(review.status)}
                  </span>
                  {review.issueArea === null ? null : (
                    <code>{review.issueArea}</code>
                  )}
                </p>
                {review.comment === null ? null : <small>{review.comment}</small>}
              </article>
            ))}
          </div>
        ) : (
          <p>No internal review has been recorded.</p>
        )}

        <h2>User feedback</h2>
        {trace.feedback.length > 0 ? (
          <div className="feedback-list">
            {trace.feedback.map((feedback) => (
              <article key={feedback.feedbackId}>
                <div>
                  <strong>{feedback.type.replaceAll("_", " ")}</strong>
                  <span>{formatTimestamp(feedback.createdAt)}</span>
                </div>
                {feedback.comment === null ? null : (
                  <small>{feedback.comment}</small>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p>No user feedback has been received.</p>
        )}
      </div>
    </section>
  );
}

function tabLabel(tab: InspectorTab): string {
  switch (tab) {
    case "input":
      return "Input";
    case "output":
      return "Output";
    case "metadata":
      return "Metadata";
  }
}

function reviewStateLabel(value: TraceView["reviewStatus"]): string {
  switch (value) {
    case "open":
      return "Needs follow-up";
    case "resolved":
      return "Resolved";
    case "ignored":
      return "Ignored";
    default:
      return "Unreviewed";
  }
}

function ingestStateLabel(value: string): string {
  switch (value) {
    case "open":
      return "Trace open";
    case "sealed_complete":
      return "Sealed complete";
    case "sealed_partial":
      return "Sealed partial";
    default:
      return value.replaceAll("_", " ");
  }
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
