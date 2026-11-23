create table if not exists evaluator_versions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version integer not null check (version > 0),
  kind text not null check (
    kind in (
      'exact',
      'contains',
      'regex',
      'json_valid',
      'max_latency_ms',
      'max_cost_micros',
      'max_tool_errors'
    )
  ),
  config jsonb not null default '{}'::jsonb,
  created_by_subject text not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  unique (name, version)
);

create table if not exists evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  dataset_revision_id uuid not null
    references dataset_revisions(id) on delete restrict,
  evaluator_version_id uuid not null
    references evaluator_versions(id) on delete restrict,
  trace_selector jsonb not null,
  status text not null default 'queued' check (
    status in ('queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  total_cases integer not null default 0,
  scored_cases integer not null default 0,
  passed_cases integer not null default 0,
  failed_cases integer not null default 0,
  missing_cases integer not null default 0,
  unscorable_cases integer not null default 0,
  errored_cases integer not null default 0,
  average_score double precision,
  requested_by_subject text not null,
  requested_by_name text not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  last_error text
);

create index if not exists evaluation_runs_created_idx
  on evaluation_runs (created_at desc, id desc);

create table if not exists evaluation_cases (
  id uuid primary key default gen_random_uuid(),
  evaluation_run_id uuid not null
    references evaluation_runs(id) on delete cascade,
  dataset_item_id uuid not null
    references dataset_items(id) on delete restrict,
  case_id text not null,
  candidate_trace_id text references traces(trace_id) on delete set null,
  candidate_output_content_ref text,
  status text not null default 'pending' check (
    status in ('pending', 'missing', 'unscorable', 'completed', 'failed')
  ),
  score double precision check (score is null or (score >= 0 and score <= 1)),
  passed boolean,
  reason text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evaluation_run_id, dataset_item_id)
);

create index if not exists evaluation_cases_run_idx
  on evaluation_cases (evaluation_run_id, status, case_id);

create table if not exists evaluation_jobs (
  evaluation_run_id uuid primary key
    references evaluation_runs(id) on delete cascade,
  state text not null default 'pending' check (
    state in ('pending', 'processing', 'completed', 'failed')
  ),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  attempt_count integer not null default 0,
  last_error text
);

create index if not exists evaluation_jobs_pending_idx
  on evaluation_jobs (state, requested_at);

alter table scores
  add column if not exists evaluation_run_id uuid
    references evaluation_runs(id) on delete cascade,
  add column if not exists dataset_item_id uuid
    references dataset_items(id) on delete set null,
  add column if not exists evaluator_version_id uuid
    references evaluator_versions(id) on delete restrict;

create unique index if not exists scores_evaluation_item_idx
  on scores (evaluation_run_id, dataset_item_id)
  where evaluation_run_id is not null and dataset_item_id is not null;
