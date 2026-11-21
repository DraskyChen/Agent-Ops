import {
  Activity,
  ArrowLeft,
  Braces,
  Gauge,
  Timer,
} from "lucide-react";

import type {
  InspectorTab,
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
}: {
  trace: TraceView;
  selectedSpan: TraceSpanView | null;
  inspectorTab: InspectorTab;
  onSelectSpan: (span: TraceSpanView) => void;
  onInspectorTab: (tab: InspectorTab) => void;
  onBack: () => void;
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
            <code className="trace-id">{trace.id}</code>
          </div>
        </div>
        <div className="detail-metadata">
          <MetaItem label="Task" value={trace.taskType} />
          <MetaItem label="Model" value={trace.model} />
          <MetaItem label="Environment" value={trace.environment} />
          <MetaItem label="Session" value={trace.sessionId} />
        </div>
      </div>

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
    </div>
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
