alter table feedback
  add column if not exists event_id text,
  add column if not exists actor_ref text;

create unique index if not exists feedback_trace_event_idx
  on feedback (trace_id, event_id)
  where event_id is not null;

create index if not exists feedback_trace_created_idx
  on feedback (trace_id, created_at desc);

create table if not exists trace_reviews (
  id uuid primary key default gen_random_uuid(),
  trace_id text not null references traces(trace_id) on delete cascade,
  reviewer_subject text not null,
  reviewer_name text not null,
  status text not null check (status in ('open', 'resolved', 'ignored')),
  issue_area text check (
    issue_area is null or issue_area in (
      'prompt',
      'model',
      'tool',
      'retrieval',
      'data',
      'infrastructure',
      'other'
    )
  ),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists trace_reviews_trace_created_idx
  on trace_reviews (trace_id, created_at desc, id desc);

create table if not exists auth_login_states (
  state_hash text primary key,
  code_verifier text not null,
  nonce text not null,
  return_to text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists auth_login_states_expiry_idx
  on auth_login_states (expires_at);

create table if not exists auth_sessions (
  session_hash text primary key,
  subject text not null,
  display_name text not null,
  email text,
  role text not null check (role in ('viewer', 'reviewer', 'admin')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists auth_sessions_expiry_idx
  on auth_sessions (expires_at);

create table if not exists content_access_log (
  id uuid primary key default gen_random_uuid(),
  content_id uuid not null,
  actor_subject text,
  decision text not null check (
    decision in ('allowed', 'denied', 'not_found', 'expired', 'error')
  ),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists content_access_log_content_idx
  on content_access_log (content_id, created_at desc);

alter table trace_aggregation_jobs
  add column if not exists not_before timestamptz not null default now();

create index if not exists trace_aggregation_jobs_due_idx
  on trace_aggregation_jobs (state, not_before, requested_at);
