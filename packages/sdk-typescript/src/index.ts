export {
  ATTR,
  ENUMS,
  SCHEMA_VERSION,
  TASK_TYPES,
  normalizeSpanType,
  normalizeTaskType,
} from "@agent-ops/contracts";

export {
  commonAttributes,
  redact,
  REDACTION_RULE_VERSION,
  summarize,
} from "./attributes.js";
export {
  configureTracing,
  getAgentTracer,
  shutdownTracing,
  type TracingConfig,
} from "./runtime.js";
export {
  currentSpanId,
  currentTraceId,
  withAgentRun,
  withLlmCall,
  withRetrieval,
  withSubAgent,
  withToolCall,
  type AgentRunHandle,
  type AgentRunOptions,
  type LlmCallTelemetry,
  type LlmCallOptions,
  type RetrievalOptions,
  type SubAgentOptions,
  type ToolCallOptions,
} from "./tracing.js";

