import {
  Activity,
  Braces,
  Database,
  FlaskConical,
  Gauge,
  LayoutList,
  LockKeyhole,
  Moon,
  RefreshCw,
  Sun,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  healthLabel,
  useServerHealth,
} from "./features/health/useServerHealth.js";
import { TraceDetailPage } from "./features/traces/TraceDetailPage.js";
import { TraceListPage } from "./features/traces/TraceListPage.js";
import { useTraceExplorer } from "./features/traces/useTraceExplorer.js";

type Theme = "light" | "dark";

export function Console() {
  const health = useServerHealth();
  const explorer = useTraceExplorer();
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
            <NavItem active icon={<LayoutList size={16} />} label="Traces" />
            <NavItem icon={<Gauge size={16} />} label="Dashboards" disabled />
            <NavItem icon={<FlaskConical size={16} />} label="Evaluations" disabled />
          </NavSection>
          <NavSection label="Manage">
            <NavItem icon={<Braces size={16} />} label="Prompts" disabled />
            <NavItem icon={<Database size={16} />} label="Datasets" disabled />
          </NavSection>
        </nav>

        <div className="sidebar-bottom">
          <div className="workspace-card">
            <span className="workspace-avatar">AO</span>
            <div>
              <strong>Agent Platform</strong>
              <small>Development workspace</small>
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
              {explorer.selectedTrace === null
                ? explorer.traces.find(
                    (trace) => trace.id === explorer.selectedTraceId,
                  )?.runName ?? "Traces"
                : explorer.selectedTrace.runName}
            </strong>
          </div>
          <div className="topbar-actions">
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
            <button
              className="button secondary compact"
              type="button"
              onClick={() => void explorer.loadTraces()}
              disabled={explorer.loading}
            >
              <RefreshCw size={14} />
              {explorer.loading ? "Loading" : "Refresh"}
            </button>
          </div>
        </header>

        {explorer.selectedTraceId === null ? (
          <TraceListPage
            traces={explorer.filteredTraces}
            query={explorer.query}
            setQuery={explorer.setQuery}
            statusFilter={explorer.statusFilter}
            setStatusFilter={explorer.setStatusFilter}
            environment={explorer.environment}
            setEnvironment={explorer.setEnvironment}
            onOpenTrace={explorer.openTrace}
            allTraces={explorer.traces}
            loading={explorer.loading}
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
          />
        )}
      </main>
    </div>
  );
}

function DetailLoading() {
  return (
    <div className="trace-detail-page">
      <div className="detail-loading" aria-live="polite">
        <Activity size={20} />
        <strong>Loading trace detail…</strong>
        <span>Resolving spans and content from the ingest store.</span>
      </div>
    </div>
  );
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
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
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
    <a className={`side-nav-item ${active ? "active" : ""}`} href="/console">
      {icon}
      <span>{label}</span>
    </a>
  );
}
