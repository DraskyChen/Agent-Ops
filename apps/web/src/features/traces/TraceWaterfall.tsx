import type { TraceSpanView } from "./model.js";
import { formatDuration, SpanTypeIcon } from "./TracePrimitives.js";

export function TraceWaterfall({
  spans,
  selectedSpanId,
  onSelectSpan,
}: {
  spans: TraceSpanView[];
  selectedSpanId: string | null;
  onSelectSpan: (span: TraceSpanView) => void;
}) {
  if (spans.length === 0) {
    return <div className="inspector-empty">No spans match this view.</div>;
  }
  const start = Math.min(
    ...spans.map((span) => new Date(span.startTime).getTime()),
  );
  const end = Math.max(
    ...spans.map((span) => new Date(span.endTime).getTime()),
  );
  const total = Math.max(1, end - start);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="waterfall">
      <div className="waterfall-axis">
        <span>Span</span>
        <div>
          {ticks.map((tick) => (
            <span key={tick} style={{ left: `${tick * 100}%` }}>
              {formatDuration(total * tick)}
            </span>
          ))}
        </div>
      </div>
      <div className="waterfall-rows">
        {spans.map((span) => {
          const spanStart = new Date(span.startTime).getTime();
          const spanEnd = new Date(span.endTime).getTime();
          const left = ((spanStart - start) / total) * 100;
          const width = Math.max(0.35, ((spanEnd - spanStart) / total) * 100);
          return (
            <button
              className={`waterfall-row ${
                selectedSpanId === span.id ? "selected" : ""
              }`}
              type="button"
              key={span.id}
              onClick={() => onSelectSpan(span)}
            >
              <span className="waterfall-label">
                <span className={`span-icon ${span.type}`}>
                  <SpanTypeIcon type={span.type} />
                </span>
                <span>
                  <strong>{span.name}</strong>
                  <small>{formatDuration(span.latencyMs)}</small>
                </span>
              </span>
              <span className="waterfall-track">
                <span
                  className={`waterfall-bar ${span.type} ${span.status}`}
                  style={{
                    left: `${left}%`,
                    width: `${Math.min(100 - left, width)}%`,
                  }}
                />
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
