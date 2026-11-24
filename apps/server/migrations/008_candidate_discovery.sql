create table if not exists trace_candidate_dismissals (
  trace_id text primary key references traces(trace_id) on delete cascade,
  dismissed_by_subject text not null,
  dismissed_by_name text not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists trace_candidate_dismissals_created_idx
  on trace_candidate_dismissals (created_at desc);

create index if not exists feedback_negative_trace_idx
  on feedback (trace_id, type)
  where type in ('thumbs_down', 'retry', 'abandon');

create index if not exists trace_reviews_open_trace_idx
  on trace_reviews (trace_id, created_at desc)
  where status = 'open';

create index if not exists evaluation_cases_candidate_trace_idx
  on evaluation_cases (candidate_trace_id)
  where candidate_trace_id is not null;
