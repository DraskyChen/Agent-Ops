create table if not exists trace_metrics_hourly (
  bucket_start timestamptz not null,
  app_name text not null default '',
  environment text not null default '',
  task_type text not null default '',
  model text not null default '',
  prompt_version text not null default '',
  service_version text not null default '',
  run_status text not null default 'unknown',
  trace_count bigint not null default 0,
  success_count bigint not null default 0,
  failed_count bigint not null default 0,
  partial_count bigint not null default 0,
  cancelled_count bigint not null default 0,
  timeout_count bigint not null default 0,
  unknown_count bigint not null default 0,
  cost_micros bigint not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  tool_call_count bigint not null default 0,
  tool_trace_count bigint not null default 0,
  tool_error_trace_count bigint not null default 0,
  duration_count bigint not null default 0,
  latency_le_50 bigint not null default 0,
  latency_le_100 bigint not null default 0,
  latency_le_250 bigint not null default 0,
  latency_le_500 bigint not null default 0,
  latency_le_1000 bigint not null default 0,
  latency_le_2000 bigint not null default 0,
  latency_le_5000 bigint not null default 0,
  latency_le_10000 bigint not null default 0,
  latency_le_30000 bigint not null default 0,
  latency_le_60000 bigint not null default 0,
  primary key (
    bucket_start,
    app_name,
    environment,
    task_type,
    model,
    prompt_version,
    service_version,
    run_status
  )
);

create index if not exists trace_metrics_hourly_filter_idx
  on trace_metrics_hourly (
    bucket_start,
    environment,
    app_name,
    task_type,
    model
  );

create table if not exists trace_metric_rollup_jobs (
  bucket_start timestamptz primary key,
  state text not null default 'pending',
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0,
  last_error text
);

create index if not exists trace_metric_rollup_jobs_pending_idx
  on trace_metric_rollup_jobs (state, requested_at);
