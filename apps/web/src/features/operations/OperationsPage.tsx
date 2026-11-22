import {
  Activity,
  Archive,
  CircleX,
  Clock3,
  Database,
  HardDrive,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { IngestHealthResponse } from "@agent-ops/contracts";

import { Metric } from "../traces/TracePrimitives.js";
import { fetchIngestHealth } from "./api.js";

export function OperationsPage() {
  const [health, setHealth] = useState<IngestHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setHealth(await fetchIngestHealth(24));
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load operations health",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading && health === null) {
    return <div className="page detail-loading">Loading operations health…</div>;
  }

  return (
    <div className="page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Ingest health</h1>
          <p>Batch acceptance, rejection reasons, aggregation backlog, and content state.</p>
        </div>
        <button
          className="button secondary compact"
          type="button"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error === null ? null : (
        <div className="data-error" role="alert">
          <CircleX size={15} />
          {error}
        </div>
      )}

      {health === null ? null : (
        <>
          <section className="metrics-strip">
            <Metric
              icon={<Activity size={16} />}
              label="Ingest batches"
              value={health.batches.total.toLocaleString()}
              detail={`last ${health.windowHours} hours`}
            />
            <Metric
              icon={<Database size={16} />}
              label="Accepted spans"
              value={health.batches.acceptedSpans.toLocaleString()}
              detail={`last ${health.windowHours}h · ${health.batches.rejectedSpans.toLocaleString()} rejected`}
            />
            <Metric
              icon={<Clock3 size={16} />}
              label="Aggregation backlog"
              value={health.aggregation.pending.toLocaleString()}
              detail={`global queue · ${health.aggregation.failed} failed`}
            />
            <Metric
              icon={<HardDrive size={16} />}
              label="Available content"
              value={health.content.available.toLocaleString()}
              detail={`global objects · ${health.content.expired} expired`}
            />
          </section>

          <section className="operations-grid">
            <article className="operations-card">
              <div className="panel-heading">
                <div>
                  <strong>Batch outcomes</strong>
                  <small>Last {health.windowHours} hours</small>
                </div>
              </div>
              <StatusLine
                label="Accepted"
                value={health.batches.accepted}
                tone="success"
              />
              <StatusLine
                label="Partial"
                value={health.batches.partial}
                tone="partial"
              />
              <StatusLine
                label="Failed"
                value={health.batches.failed}
                tone="failed"
              />
            </article>

            <article className="operations-card">
              <div className="panel-heading">
                <div>
                  <strong>Rejected spans</strong>
                  <small>Top reasons in the last {health.windowHours} hours</small>
                </div>
              </div>
              {health.rejectsByReason.length === 0 ? (
                <p className="empty-copy">No spans were rejected.</p>
              ) : (
                <div className="reason-list">
                  {health.rejectsByReason.map((reason) => (
                    <div key={reason.reason}>
                      <code>{reason.reason}</code>
                      <strong>{reason.count}</strong>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="operations-card">
              <div className="panel-heading">
                <div>
                  <strong>Aggregation</strong>
                  <small>Global current worker state</small>
                </div>
              </div>
              <StatusLine
                label="Pending"
                value={health.aggregation.pending}
                tone="partial"
              />
              <StatusLine
                label="Processing"
                value={health.aggregation.processing}
                tone="success"
              />
              <StatusLine
                label="Failed"
                value={health.aggregation.failed}
                tone="failed"
              />
              <p className="operations-note">
                Oldest pending:{" "}
                {health.aggregation.oldestPendingAt === null
                  ? "none"
                  : new Date(
                      health.aggregation.oldestPendingAt,
                    ).toLocaleString()}
              </p>
            </article>

            <article className="operations-card">
              <div className="panel-heading">
                <div>
                  <strong>Content lifecycle</strong>
                  <small>Global object metadata state</small>
                </div>
              </div>
              <StatusLine
                label="Available"
                value={health.content.available}
                tone="success"
              />
              <StatusLine
                label="Unavailable"
                value={health.content.unavailable}
                tone="partial"
              />
              <StatusLine
                label="Expired"
                value={health.content.expired}
                tone="failed"
              />
            </article>
          </section>

          <section className="operations-footnote">
            <Archive size={15} />
            Generated {new Date(health.generatedAt).toLocaleString()}. Aggregate
            health never exposes credentials, object keys, or captured payloads.
          </section>
        </>
      )}
    </div>
  );
}

function StatusLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "success" | "partial" | "failed";
}) {
  return (
    <div className="operations-status-line">
      <span className={`service-dot ${tone}`} />
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}
