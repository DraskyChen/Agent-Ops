import {
  Activity,
  Braces,
  Database,
  FlaskConical,
  LayoutDashboard,
  LayoutList,
  LockKeyhole,
  LogIn,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  healthLabel,
  useServerHealth,
} from "./features/health/useServerHealth.js";
import { DatasetsPage } from "./features/datasets/DatasetsPage.js";
import { EvaluationsPage } from "./features/evaluations/EvaluationsPage.js";
import {
  DashboardPage,
} from "./features/metrics/DashboardPage.js";
import type {
  DashboardDrilldown,
} from "./features/metrics/model.js";
import { OperationsPage } from "./features/operations/OperationsPage.js";
import { TraceDetailPage } from "./features/traces/TraceDetailPage.js";
import { TraceListPage } from "./features/traces/TraceListPage.js";
import { useTraceExplorer } from "./features/traces/useTraceExplorer.js";
import {
  DEFAULT_FILTERS,
  type TraceFilters,
} from "./features/traces/model.js";

type Theme = "light" | "dark";
type ConsolePage =
  | "dashboards"
  | "traces"
  | "operations"
  | "evaluations"
  | "datasets";

export function Console() {
  const health = useServerHealth();
  const [initial] = useState(readInitialConsoleState);
  const explorer = useTraceExplorer(initial.filters);
  const authError = new URLSearchParams(window.location.search).get(
    "authError",
  );
  const [page, setPage] = useState<ConsolePage>(initial.page);
  const [theme, setTheme] = useState<Theme>(() =>
    window.localStorage.getItem("agent-ops-theme") === "dark" ? "dark" : "light",
  );

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("agent-ops-theme", theme);
  }, [theme]);

  return (
    <div className="console-shell">
      <aside className="sidebar">
        <a className="brand console-brand" href="/">
          <span className="brand-mark">
            <Activity size={18} />
          </span>
          <span>
            <strong>Agent Ops</strong>
            <small>Observability</small>
          </span>
        </a>

        <nav className="side-nav" aria-label="Main navigation">
          <NavSection label="Observe">
            <NavItem
              active={page === "dashboards"}
              icon={<LayoutDashboard size={16} />}
              label="Dashboards"
              onClick={() => {
                setPage("dashboards");
                explorer.closeTrace();
                updateConsoleUrl("dashboards");
              }}
            />
            <NavItem
              active={page === "traces"}
              icon={<LayoutList size={16} />}
              label="Traces"
              onClick={() => {
                setPage("traces");
                explorer.closeTrace();
                updateConsoleUrl("traces");
              }}
            />
            <NavItem
              active={page === "operations"}
              icon={<ShieldCheck size={16} />}
              label="Operations"
              onClick={() => {
                setPage("operations");
                explorer.closeTrace();
                updateConsoleUrl("operations");
              }}
            />
            <NavItem
              active={page === "evaluations"}
              icon={<FlaskConical size={16} />}
              label="Evaluations"
              onClick={() => {
                setPage("evaluations");
                explorer.closeTrace();
                updateConsoleUrl("evaluations");
              }}
            />
          </NavSection>
          <NavSection label="Manage">
            <NavItem icon={<Braces size={16} />} label="Prompts" disabled />
            <NavItem
              active={page === "datasets"}
              icon={<Database size={16} />}
              label="Datasets"
              onClick={() => {
                setPage("datasets");
                explorer.closeTrace();
                updateConsoleUrl("datasets");
              }}
            />
          </NavSection>
        </nav>

        <div className="sidebar-bottom">
          <div className="workspace-card">
            <span className="workspace-avatar">
              {explorer.me?.displayName.slice(0, 2).toUpperCase() ?? "AO"}
            </span>
            <div>
              <strong>{explorer.me?.displayName ?? "Agent Platform"}</strong>
              <small>
                {explorer.me === null
                  ? "Authentication required"
                  : `${explorer.me.role} workspace`}
              </small>
            </div>
          </div>
          <div className="service-state">
            <span className={`service-dot ${health.state}`} />
            <div>
              <strong>{healthLabel(health)}</strong>
              <small>Contract {health.schemaVersion ?? "—"}</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="console-content">
        <header className="console-topbar">
          <div className="breadcrumb">
            <span>Agent Platform</span>
            <span>/</span>
            <strong>
              {page === "dashboards"
                ? "Dashboards"
                : page === "operations"
                  ? "Operations"
                  : page === "evaluations"
                    ? "Evaluations"
                    : page === "datasets"
                      ? "Datasets"
                      : explorer.selectedTraceId === null
                        ? "Traces"
                        : explorer.selectedTrace?.runName ?? "Trace detail"}
            </strong>
          </div>
          <div className="topbar-actions">
            {explorer.me === null ? null : (
              <span className="demo-badge">{explorer.me.role}</span>
            )}
            <span className="demo-badge">
              {explorer.loadError === null ? "Live data" : "API error"}
            </span>
            <button
              className="icon-button"
              type="button"
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`}
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            {page === "traces" && explorer.selectedTraceId === null ? (
              <button
                className="button secondary compact"
                type="button"
                onClick={() => void explorer.refresh()}
                disabled={explorer.loading}
              >
                <RefreshCw size={14} />
                {explorer.loading ? "Loading" : "Refresh"}
              </button>
            ) : null}
            {explorer.me === null ? (
              <a className="button primary compact" href="/auth/login?returnTo=/console">
                <LogIn size={14} />
                Sign in
              </a>
            ) : (
              <button
                className="icon-button"
                type="button"
                aria-label="Sign out"
                title="Sign out"
                onClick={() => void signOut()}
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </header>

        {explorer.authLoading ? (
          <AuthLoading />
        ) : explorer.me === null ? (
          <AuthRequired error={authError} />
        ) : page === "dashboards" ? (
          <DashboardPage
            onDrilldown={(drilldown) => {
              setPage("traces");
              explorer.closeTrace();
              const filters = traceFiltersFromDrilldown(drilldown);
              explorer.replaceFilters(filters);
              updateConsoleUrl("traces", filters);
            }}
          />
        ) : page === "operations" ? (
          <OperationsPage />
        ) : page === "datasets" ? (
          <DatasetsPage canManage={canManage(explorer.me.role)} />
        ) : page === "evaluations" ? (
          <EvaluationsPage
            canManage={canManage(explorer.me.role)}
            canJudge={explorer.me.role === "admin"}
          />
        ) : explorer.selectedTraceId === null ? (
          <TraceListPage
            traces={explorer.traces}
            filters={explorer.filters}
            setFilter={explorer.setFilter}
            onOpenTrace={explorer.openTrace}
            loading={explorer.loading}
            loadingMore={explorer.loadingMore}
            hasMore={explorer.nextCursor !== null}
            onLoadMore={() => void explorer.loadMore()}
            error={explorer.loadError}
          />
        ) : explorer.detailLoading || explorer.selectedTrace === null ? (
          <DetailLoading />
        ) : (
          <TraceDetailPage
            trace={explorer.selectedTrace}
            selectedSpan={explorer.selectedSpan}
            inspectorTab={explorer.inspectorTab}
            onSelectSpan={(span) => explorer.selectSpan(span.id)}
            onInspectorTab={explorer.setInspectorTab}
            onBack={explorer.closeTrace}
            me={explorer.me}
            reviewSubmitting={explorer.reviewSubmitting}
            onSubmitReview={explorer.submitReview}
            error={explorer.loadError}
          />
        )}
      </main>
    </div>
  );
}

function AuthLoading() {
  return (
    <div className="auth-state">
      <Activity size={22} />
      <strong>Checking your Agent Ops session…</strong>
      <span>Human identity is separate from SDK ingest credentials.</span>
    </div>
  );
}

function AuthRequired({ error }: { error: string | null }) {
  return (
    <div className="auth-state">
      <ShieldCheck size={23} />
      <strong>Sign in to inspect traces</strong>
      <span>
        {error === null
          ? "Trace metadata and captured content use role-based access."
          : "SSO sign-in did not complete. Please try again."}
      </span>
      <a className="button primary" href="/auth/login?returnTo=/console">
        <LogIn size={15} />
        Continue with SSO
      </a>
    </div>
  );
}

function DetailLoading() {
  return (
    <div className="trace-detail-page">
      <div className="detail-loading" aria-live="polite">
        <Activity size={20} />
        <strong>Loading trace detail…</strong>
        <span>Resolving spans, review history, and permitted content.</span>
      </div>
    </div>
  );
}

async function signOut(): Promise<void> {
  await fetch("/auth/logout", {
    method: "POST",
    credentials: "same-origin",
  });
  window.location.assign("/console");
}

function traceFiltersFromDrilldown(
  drilldown: DashboardDrilldown,
): TraceFilters {
  return {
    ...DEFAULT_FILTERS,
    timeRange: "custom",
    startedAfter: drilldown.startedAfter,
    startedBefore: drilldown.startedBefore,
    status:
      drilldown.status === "success" ||
      drilldown.status === "failed" ||
      drilldown.status === "partial" ||
      drilldown.status === "cancelled" ||
      drilldown.status === "timeout"
        ? drilldown.status
        : "all",
    hasErrors: drilldown.hasErrors ?? "all",
    environment: drilldown.environment ?? "all",
    appName: drilldown.appName ?? "",
    taskType: drilldown.taskType ?? "",
    model: drilldown.model ?? "",
    promptVersion: drilldown.promptVersion ?? "",
    serviceVersion: drilldown.serviceVersion ?? "",
  };
}

function readInitialConsoleState(): {
  page: ConsolePage;
  filters: TraceFilters;
} {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  const page: ConsolePage =
    view === "dashboards" ||
    view === "operations" ||
    view === "evaluations" ||
    view === "datasets"
      ? view
      : "traces";
  const startedAfter = params.get("startedAfter");
  const startedBefore = params.get("startedBefore");
  return {
    page,
    filters: {
      ...DEFAULT_FILTERS,
      ...(startedAfter === null
        ? {}
        : {
            timeRange: "custom" as const,
            startedAfter,
            startedBefore: startedBefore ?? undefined,
          }),
      ...(params.get("status") === null
        ? {}
        : { status: params.get("status") as TraceFilters["status"] }),
      ...(params.get("environment") === null
        ? {}
        : { environment: params.get("environment") ?? "all" }),
      ...(params.get("appName") === null
        ? {}
        : { appName: params.get("appName") ?? "" }),
      ...(params.get("taskType") === null
        ? {}
        : { taskType: params.get("taskType") ?? "" }),
      ...(params.get("model") === null
        ? {}
        : { model: params.get("model") ?? "" }),
      ...(params.get("promptVersion") === null
        ? {}
        : { promptVersion: params.get("promptVersion") ?? "" }),
      ...(params.get("serviceVersion") === null
        ? {}
        : { serviceVersion: params.get("serviceVersion") ?? "" }),
      ...(params.get("hasErrors") === "true" ||
      params.get("hasErrors") === "false"
        ? { hasErrors: params.get("hasErrors") as "true" | "false" }
        : {}),
    },
  };
}

function canManage(role: "viewer" | "reviewer" | "admin"): boolean {
  return role === "reviewer" || role === "admin";
}

function updateConsoleUrl(
  page: ConsolePage,
  filters?: TraceFilters,
): void {
  const params = new URLSearchParams({ view: page });
  if (filters !== undefined) {
    if (filters.startedAfter !== undefined) {
      params.set("startedAfter", filters.startedAfter);
    }
    if (filters.startedBefore !== undefined) {
      params.set("startedBefore", filters.startedBefore);
    }
    if (filters.status !== "all") {
      params.set("status", filters.status);
    }
    if (filters.environment !== "all") {
      params.set("environment", filters.environment);
    }
    setText(params, "appName", filters.appName);
    setText(params, "taskType", filters.taskType);
    setText(params, "model", filters.model);
    setText(params, "promptVersion", filters.promptVersion);
    setText(params, "serviceVersion", filters.serviceVersion);
    if (filters.hasErrors !== "all") {
      params.set("hasErrors", filters.hasErrors);
    }
  }
  window.history.pushState({}, "", `/console?${params.toString()}`);
}

function setText(
  params: URLSearchParams,
  key: string,
  value: string,
): void {
  if (value.trim() !== "") {
    params.set(key, value.trim());
  }
}

function NavSection({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="nav-section">
      <span>{label}</span>
      {children}
    </div>
  );
}

function NavItem({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  if (disabled) {
    return (
      <button
        className="side-nav-item disabled"
        type="button"
        disabled
        title="Available in a later milestone"
      >
        {icon}
        <span>{label}</span>
        <LockKeyhole size={12} />
      </button>
    );
  }

  return (
    <button
      className={`side-nav-item ${active ? "active" : ""}`}
      type="button"
      onClick={onClick}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
