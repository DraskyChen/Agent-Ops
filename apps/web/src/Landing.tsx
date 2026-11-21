import {
  Activity,
  ArrowRight,
  Braces,
  Database,
  ShieldCheck,
} from "lucide-react";
import {
  healthLabel,
  useServerHealth,
} from "./features/health/useServerHealth.js";

export function Landing() {
  const health = useServerHealth();

  return (
    <div className="landing-shell">
      <header className="landing-nav">
        <Brand />
        <div className="landing-nav-actions">
          <div className={`health-pill ${health.state}`}>
            <span />
            {health.state === "ok" ? "Platform online" : healthLabel(health)}
          </div>
          <a className="button primary" href="/console">
            Open console
          </a>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-copy">
          <p className="eyebrow">Agent observability</p>
          <h1>See the whole run, not just the request.</h1>
          <p className="landing-lede">
            Inspect every model call, tool invocation, retrieval step, and
            sub-agent in one trace. Move from a failed run to the exact step
            that caused it.
          </p>
          <div className="landing-cta">
            <a className="button primary large" href="/console">
              Explore traces
              <ArrowRight size={16} />
            </a>
            <span>Connect an SDK to inspect your first live trace.</span>
          </div>
        </section>

        <section className="landing-preview" aria-label="Product status">
          <div className="preview-toolbar">
            <div>
              <Activity size={17} />
              <strong>Workspace health</strong>
            </div>
            <span className="demo-badge">Demo</span>
          </div>
          <div className="preview-metrics">
            <PreviewMetric label="Traces" value="12.8k" change="+18%" />
            <PreviewMetric label="Success" value="96.4%" change="+1.2%" />
            <PreviewMetric label="P95 latency" value="8.4s" change="-0.8s" />
          </div>
          <div className="preview-trace">
            <div className="preview-trace-head">
              <strong>refund-agent</strong>
              <span className="status-badge success">Success</span>
            </div>
            <PreviewRow icon={<Braces size={14} />} label="chat" value="864 ms" />
            <PreviewRow icon={<Braces size={14} />} label="query_order" value="312 ms" />
            <PreviewRow
              icon={<Braces size={14} />}
              label="check_refund_policy"
              value="205 ms"
            />
            <PreviewRow icon={<Braces size={14} />} label="chat" value="1.21 s" />
          </div>
          <div className="preview-footer">
            <span>Contract {health.schemaVersion ?? "—"}</span>
            <span>OTLP · PostgreSQL · MinIO</span>
          </div>
        </section>
      </main>

      <footer className="landing-features">
        <Feature
          icon={<Braces size={18} />}
          title="Full execution tree"
          copy="LLM calls, tools, retrieval, and child agents in one trace."
        />
        <Feature
          icon={<Database size={18} />}
          title="Content-aware"
          copy="Prompt, response, and tool payloads stay inspectable."
        />
        <Feature
          icon={<ShieldCheck size={18} />}
          title="Private by default"
          copy="OTel ingestion, internal storage, and explicit capture policy."
        />
      </footer>
    </div>
  );
}

function Brand() {
  return (
    <a className="brand" href="/">
      <span className="brand-mark">
        <Activity size={18} />
      </span>
      <span>
        <strong>Agent Ops</strong>
        <small>Observability</small>
      </span>
    </a>
  );
}

function PreviewMetric({
  label,
  value,
  change,
}: {
  label: string;
  value: string;
  change: string;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{change}</small>
    </div>
  );
}

function PreviewRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="preview-row">
      <span>
        {icon}
        {label}
      </span>
      <code>{value}</code>
    </div>
  );
}

function Feature({
  icon,
  title,
  copy,
}: {
  icon: React.ReactNode;
  title: string;
  copy: string;
}) {
  return (
    <article>
      <span>{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
    </article>
  );
}

