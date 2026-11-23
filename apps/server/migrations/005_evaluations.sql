alter table traces
  add column if not exists eval_case_id text;

create index if not exists traces_eval_case_idx
  on traces (eval_case_id, start_time desc)
  where eval_case_id is not null;

create table if not exists datasets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  created_by_subject text not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists datasets_name_unique_idx
  on datasets (lower(name));

create table if not exists dataset_revisions (
  id uuid primary key default gen_random_uuid(),
  dataset_id uuid not null references datasets(id) on delete cascade,
  revision integer not null check (revision > 0),
  note text,
  created_by_subject text not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  unique (dataset_id, revision)
);

create index if not exists dataset_revisions_dataset_idx
  on dataset_revisions (dataset_id, revision desc);

create table if not exists dataset_items (
  id uuid primary key default gen_random_uuid(),
  dataset_revision_id uuid not null
    references dataset_revisions(id) on delete cascade,
  case_id text not null,
  source_trace_id text not null,
  app_name text,
  prompt_version text,
  task_type text,
  model text,
  environment text,
  run_status text,
  source_started_at timestamptz,
  input_content_ref text not null,
  baseline_output_content_ref text not null,
  expected_output_content_ref text,
  expected_behavior text,
  tags jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (dataset_revision_id, case_id)
);

create index if not exists dataset_items_source_trace_idx
  on dataset_items (source_trace_id);
