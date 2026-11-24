import {
  Activity,
  ArrowUpRight,
  CircleX,
  Clock3,
  Gauge,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import { useEffect, useState } from "react";

import type {
  SessionListResponse,
  SessionSummary,
  SessionStatusCounts,
} from "@agent-ops/contracts";

import {
  formatCost,
  formatDuration,
  Metric,
} from "../traces/TracePrimitives.js";
import { fetchSessions } from "./api.js";

export function SessionsPage({
  onOpenSession,
}: {
  onOpenSession: (sessionId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [data, setData] = useState<SessionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timeout = window.setTimeout(() => {
      fetchSessions(search)
        .then((next) => {
          if (active) {
            setData(next);
            setError(null);
          }
        })
        .catch((loadError: unknown) => {
          if (active) {
            setError(
              loadError instanceof Error
                ? loadError.message
                : "Unable to load sessions",
            );
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });
    }, search === "" ? 0 : 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [refreshToken, search]);

  const items = data?.items ?? [];
  const totalRuns = items.reduce(
    (total, session) => total + session.traceCount,
    0,
  );
  const totalCost = items.reduce(
    (total, session) => total + session.totalCostMicros,
    0,
  );

  return (
    <div className="page sessions-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Conversation context</p>
          <h1>Sessions</h1>
          <p>
            Follow related Agent runs across one user session, including
            retries, recovery, cost, and errors.
          </p>
        </div>
        <button
          className="button secondary compact"
          type="button"
          onClick={() => setRefreshToken((current) => current + 1)}
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

      <section className="metrics-strip sessions-kpis">
        <Metric
          icon={<Activity size={16} />}
          label="Sessions"
          value={items.length.toLocaleString()}
          detail="last 30 days"
        />
        <Metric
          icon={<Clock3 size={16} />}
          label="Agent runs"
          value={totalRuns.toLocaleString()}
          detail="across loaded sessions"
        />
        <Metric
          icon={<Gauge size={16} />}
          label="Session cost"
          value={formatCost(totalCost)}
          detail="loaded sessions"
        />
        <Metric
          icon={<Wrench size={16} />}
          label="Tool errors"
          value={items
            .reduce((total, session) => total + session.toolErrorCount, 0)
            .toLocaleString()}
          detail="loaded sessions"
        />
      </section>

      <div className="session-directory-toolbar">
        <label className="search-field">
          <Search size={15} />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search session ID, run name, or application…"
            aria-label="Search sessions"
          />
        </label>
        <span>
          {loading ? "Searching…" : `${items.length} sessions loaded`}
        </span>
      </div>

      <section className="session-directory">
        {!loading && items.length === 0 ? (
          <div className="candidate-empty">
            <Clock3 size={22} />
            <strong>No matching sessions</strong>
            <span>Try a broader search or clear the query.</span>
          </div>
        ) : (
          items.map((session) => (
            <SessionCard
              key={session.sessionId}
              session={session}
              onOpen={() => onOpenSession(session.sessionId)}
            />
          ))
        )}
      </section>
    </div>
  );
}

function SessionCard({
  session,
  onOpen,
}: {
  session: SessionSummary;
  onOpen: () => void;
}) {
  return (
    <button className="session-card" type="button" onClick={onOpen}>
      <span className="session-card-main">
        <span className="session-card-heading">
          <strong>{session.sessionId}</strong>
          <ArrowUpRight size={14} />
        </span>
        <small>{session.appNames.join(", ") || "Unknown application"}</small>
        <SessionStatusCounts counts={session.statusCounts} />
      </span>
      <span className="session-card-metrics">
        <span>
          <strong>{session.traceCount}</strong>
          <small>runs</small>
        </span>
        <span>
          <strong>{formatDuration(session.durationMs ?? 0)}</strong>
          <small>duration</small>
        </span>
        <span>
          <strong>{formatCost(session.totalCostMicros)}</strong>
          <small>cost</small>
        </span>
        <span>
          <strong>{formatDateTime(session.lastEndedAt)}</strong>
          <small>last activity</small>
        </span>
      </span>
    </button>
  );
}

function SessionStatusCounts({ counts }: { counts: SessionStatusCounts }) {
  const visible = (
    ["success", "failed", "partial", "timeout"] as const
  ).filter((status) => counts[status] > 0);
  return (
    <span className="session-card-statuses">
      {visible.length === 0 ? (
        <span className="unknown">unknown</span>
      ) : (
        visible.map((status) => (
          <span className={status} key={status}>
            {counts[status]} {status}
          </span>
        ))
      )}
    </span>
  );
}

function formatDateTime(value: string | null): string {
  if (value === null) {
    return "—";
  }
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
