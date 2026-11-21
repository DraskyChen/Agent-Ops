import {
  Bot,
  Braces,
  CircleCheck,
  CircleX,
  Database,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";

import type { SpanType, TraceStatus } from "./model.js";

export function Metric({
  icon,
  label,
  value,
  detail,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="metric">
      <span className="metric-icon">{icon}</span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: TraceStatus }) {
  const Icon =
    status === "success"
      ? CircleCheck
      : status === "failed"
        ? CircleX
        : TriangleAlert;
  return (
    <span className={`status-badge ${status}`}>
      <Icon size={13} />
      {statusLabel(status)}
    </span>
  );
}

export function TypeTag({ children }: { children: ReactNode }) {
  return <span className="type-tag">{children}</span>;
}

export function SpanTypeIcon({ type }: { type: SpanType }) {
  switch (type) {
    case "agent":
      return <Bot size={15} />;
    case "llm":
      return <Braces size={15} />;
    case "tool":
      return <Wrench size={15} />;
    case "retrieval":
      return <Database size={15} />;
  }
}

export function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}

export function MetadataGrid({
  metadata,
}: {
  metadata: Record<string, string>;
}) {
  return (
    <dl className="metadata-grid">
      {Object.entries(metadata).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function statusLabel(status: TraceStatus): string {
  switch (status) {
    case "success":
      return "Success";
    case "failed":
      return "Failed";
    case "partial":
      return "Partial";
  }
}

export function spanTypeLabel(type: SpanType): string {
  switch (type) {
    case "agent":
      return "Agent run";
    case "llm":
      return "LLM call";
    case "tool":
      return "Tool";
    case "retrieval":
      return "Retrieval";
  }
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`;
  }
  return `${(milliseconds / 1000).toFixed(2)}s`;
}

export function formatCost(costMicros: number): string {
  const amount = costMicros / 1_000_000;
  return `$${amount.toFixed(amount > 0 && amount < 0.01 ? 6 : 4)}`;
}

export function formatTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}
