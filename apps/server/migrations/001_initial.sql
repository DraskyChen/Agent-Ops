create extension if not exists pgcrypto;

create table if not exists sessions (
  session_id text primary key,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  redacted_user_id text
);

create table if not exists ingest_batches (
  batch_id uuid primary key,
  owner_app text not null,
  credential_id text,
  received_at timestamptz not null,
  request_bytes bigint not null,
  payload_digest text,
  span_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  status text not null
);

create table if not exists traces (
  trace_id text primary key,
  session_id text,
  root_span_id text,
  app_name text,
  run_name text,
  service_name text,
  service_version text,
  environment text,
  task_type text,
  prompt_version text,
  model text,
  run_status text,
  stop_reason text,
  first_span_at timestamptz not null,
  last_span_at timestamptz not null,
  start_time timestamptz,
  end_time timestamptz,
  root_ended_at timestamptz,
  duration_ms bigint,
  step_count integer,
  llm_call_count integer,
  tool_call_count integer,
  tool_error_count integer,
  input_tokens bigint,
  output_tokens bigint,
  cost_micros bigint,
  currency text,
  completeness text,
  ingest_state text not null,
  sealed_at timestamptz,
  aggregation_revision bigint not null default 0
);

create table if not exists spans (
  trace_id text not null,
  span_id text not null,
  parent_span_id text,
  ingest_batch_id uuid references ingest_batches(batch_id),
  service_name text,
  service_version text,
  environment text,
  span_type text not null,
  span_subtype text,
  name text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  duration_ms bigint not null,
  status text not null,
  error_type text,
  error_category text,
  resource_attributes jsonb not null default '{}'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  input_tokens bigint,
  output_tokens bigint,
  cached_input_tokens bigint,
  reasoning_tokens bigint,
  ttft_ms bigint,
  cost_micros bigint,
  price_version_id uuid,
  input_content_ref text,
  output_content_ref text,
  content_recorded text not null default 'metadata_only',
  schema_version text not null,
  received_at timestamptz not null default now(),
  primary key (trace_id, span_id)
);

create table if not exists span_events (
  trace_id text not null,
  span_id text not null,
  event_index integer not null,
  name text not null,
  event_time timestamptz not null,
  attributes jsonb not null default '{}'::jsonb,
  primary key (trace_id, span_id, event_index),
  foreign key (trace_id, span_id) references spans(trace_id, span_id)
    on delete cascade
);

create table if not exists ingest_rejects (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid references ingest_batches(batch_id),
  trace_id text,
  span_id text,
  reason text not null,
  payload_ref text,
  created_at timestamptz not null default now()
);

create table if not exists trace_aggregation_jobs (
  trace_id text primary key,
  state text not null default 'pending',
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0,
  last_error text
);

create table if not exists content_objects (
  content_id uuid primary key default gen_random_uuid(),
  object_key text unique not null,
  owner_app text not null,
  content_kind text not null,
  media_type text not null,
  capture_mode text not null,
  size_bytes bigint not null,
  sha256 text not null,
  redaction_rule_version text not null,
  encryption text not null,
  status text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table if not exists feedback (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  span_id text,
  type text not null,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists scores (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null,
  span_id text,
  name text not null,
  value jsonb not null,
  source text not null,
  evaluator_version text not null,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists price_versions (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model_pattern text not null,
  currency text not null,
  input_micros_per_million_tokens bigint not null,
  output_micros_per_million_tokens bigint not null,
  cached_input_micros_per_million_tokens bigint,
  reasoning_micros_per_million_tokens bigint,
  effective_from timestamptz not null,
  effective_to timestamptz
);

create index if not exists traces_start_time_idx
  on traces (start_time desc, trace_id);
create index if not exists traces_environment_status_idx
  on traces (environment, run_status, start_time desc);
create index if not exists traces_app_version_idx
  on traces (app_name, service_version, start_time desc);
create index if not exists traces_model_idx
  on traces (model, start_time desc);
create index if not exists traces_session_idx
  on traces (session_id, start_time desc);
create index if not exists ingestion_jobs_pending_idx
  on trace_aggregation_jobs (state, requested_at);
create index if not exists ingest_rejects_batch_idx
  on ingest_rejects (batch_id, created_at);
create index if not exists content_expiry_idx
  on content_objects (status, expires_at);

