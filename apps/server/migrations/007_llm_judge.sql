alter table evaluator_versions
  drop constraint if exists evaluator_versions_kind_check;

alter table evaluator_versions
  add constraint evaluator_versions_kind_check check (
    kind in (
      'exact',
      'contains',
      'regex',
      'json_valid',
      'max_latency_ms',
      'max_cost_micros',
      'max_tool_errors',
      'llm_judge'
    )
  );

create table if not exists judge_calls (
  id uuid primary key default gen_random_uuid(),
  evaluation_run_id uuid not null
    references evaluation_runs(id) on delete cascade,
  evaluation_case_id uuid not null
    references evaluation_cases(id) on delete cascade,
  evaluator_version_id uuid not null
    references evaluator_versions(id) on delete restrict,
  provider text not null check (provider = 'deepseek'),
  model text not null,
  prompt_content_ref text,
  response_content_ref text,
  status text not null check (status in ('pending', 'completed', 'failed')),
  input_tokens bigint,
  output_tokens bigint,
  cost_micros bigint,
  error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (evaluation_run_id, evaluation_case_id, evaluator_version_id)
);

create index if not exists judge_calls_run_idx
  on judge_calls (evaluation_run_id, status, created_at);
