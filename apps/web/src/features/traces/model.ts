export type TraceStatus = "success" | "failed" | "partial";
export type SpanType = "agent" | "llm" | "tool" | "retrieval";
export type SpanStatus = "ok" | "error" | "partial";
export type InspectorTab = "input" | "output" | "metadata";

export interface TraceSpanView {
  id: string;
  name: string;
  type: SpanType;
  status: SpanStatus;
  depth: number;
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  costMicros?: number;
  input: string;
  output: string;
  metadata: Record<string, string>;
}

export interface TraceView {
  id: string;
  runName: string;
  sessionId: string;
  taskType: string;
  model: string;
  environment: string;
  status: TraceStatus;
  latencyMs: number;
  costMicros: number;
  inputTokens: number;
  outputTokens: number;
  stepCount: number;
  startedAt: string;
  spans: TraceSpanView[];
}
