import {
  Activity,
  ArrowLeft,
  Braces,
  CircleX,
  Clock3,
  Gauge,
  RefreshCw,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { SessionDetail, TraceListItem } from "@agent-ops/contracts";

import {
  formatCost,
  formatDuration,
  Metric,
} from "../traces/TracePrimitives.js";
import { fetchSession } from "./api.js";

export function SessionPage({
  sessionId,
  onOpenTrace,
  onBack,
  backLabel,
}: {
  sessionId: string;
  onOpenTrace: (traceId: string) => void;
  onBack: () => void;
  backLabel: string;
}) {
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setSession(await fetchSession(sessionId));
      setError(null);
    } catch (loadError) {
      setSession(null);
      setError(
        loadError instanceof Error ? loadError.message : "Unable to load session",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [sessionId]);

  return (
    <div className="page session-page">
      <div className="detail-title-row session-page-heading">
        <button
          className="icon-button back-button"
          type="button"
          aria-label={backLabel}
          onClick={onBack}
        >
          <ArrowLeft size={17} />
        </button>
        <div>
          <p className="eyebrow">Session context</p>
          <h1>Session</h1>
          <code>{sessionId}</code>
        </div>
        <button
          className="button secondary compact detail-actions"
          type="button"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={14} />
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error === null ? null : (
        <div className="data-error session-error" role="alert">
          <CircleX size={15} />
          {error}
        </div>
      )}

      {session === null ? (
        loading ? (
          <div className="detail-loading">Loading session runs…</div>
        ) : null
      ) : (
        <>
          <section className="metrics-strip session-kpis">
            <Metric
              icon={<Activity size={16} />}
              label="Agent runs"
              value={session.traceCount.toLocaleString()}
              detail={session.appNames.join(", ") || "unknown application"}
            />
            <Metric
              icon={<Clock3 size={16} />}
              label="Session duration"
              value={
                session.durationMs === null
                  ? "—"
                  : formatDuration(session.durationMs)
              }
              detail="first start to last finish"
            />
            <Metric
              icon={<Gauge size={16} />}
              label="Session cost"
              value={formatCost(session.totalCostMicros)}
              detail={`${session.inputTokens.toLocaleString()} in · ${session.outputTokens.toLocaleString()} out`}
            />
            <Metric
              icon={<Wrench size={16} />}
              label="Tool errors"
              value={session.toolErrorCount.toLocaleString()}
              detail={`${session.statusCounts.failed} failed · ${session.statusCounts.partial} partial`}
            />
          </section>

          <section className="session-status-strip">
            {Object.entries(session.statusCounts).map(([status, count]) => (
              <div key={status}>
                <span className={`session-status-dot ${status}`} />
                <strong>{count}</strong>
                <small>{status}</small>
              </div>
            ))}
          </section>

          <section className="session-timeline-panel">
            <header className="panel-heading">
              <div>
                <Braces size={15} />
                <div>
                  <strong>Run timeline</strong>
                  <small>
                    {session.firstStartedAt === null
                      ? "No start time"
                      : formatDateTime(session.firstStartedAt)}
                    {session.lastEndedAt === null
                      ? ""
                      : ` → ${formatDateTime(session.lastEndedAt)}`}
                  </small>
                </div>
              </div>
            </header>
            <div className="session-timeline">
              {session.runs.map((run, index) => (
                <SessionRun
                  run={run}
                  index={index}
                  key={run.traceId}
                  onOpen={() => onOpenTrace(run.traceId)}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function SessionRun({
  run,
  index,
  onOpen,
}: {
  run: TraceListItem;
  index: number;
  onOpen: () => void;
}) {
  return (
    <button className="session-run" type="button" onClick={onOpen}>
      <span className="session-run-sequence">{index + 1}</span>
      <span className="session-run-main">
        <span className="session-run-heading">
          <strong>{run.runName}</strong>
          <span className={`session-run-status ${run.runStatus ?? "unknown"}`}>
            {run.runStatus ?? "unknown"}
          </span>
        </span>
        <small>
          {run.appName ?? "Unknown app"} · {run.promptVersion ?? "No prompt"} ·{" "}
          {run.model ?? "Unknown model"}
        </small>
        <span className="session-run-meta">
          <span>
            {run.startedAt === null ? "unknown time" : formatDateTime(run.startedAt)}
          </span>
          <span>{formatDuration(run.latencyMs ?? 0)}</span>
          <span>{formatCost(run.costMicros ?? 0)}</span>
          <span>{run.toolErrorCount ?? 0} tool errors</span>
        </span>
      </span>
      <code>{run.traceId}</code>
    </button>
  );
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
