create table if not exists prompt_registry_events (
  id uuid primary key default gen_random_uuid(),
  prompt_version text not null
    references prompt_registry(prompt_version) on delete cascade,
  event_type text not null check (event_type in ('created', 'updated')),
  actor_subject text not null,
  actor_name text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists prompt_registry_events_version_idx
  on prompt_registry_events (prompt_version, created_at desc, id desc);

insert into prompt_registry_events (
  prompt_version, event_type, actor_subject, actor_name,
  before_state, after_state, created_at
)
select
  p.prompt_version,
  'created',
  p.created_by_subject,
  p.created_by_name,
  '{}'::jsonb,
  jsonb_build_object(
    'name', p.name,
    'owner', p.owner,
    'description', p.description,
    'status', p.status
  ),
  p.created_at
from prompt_registry p
where not exists (
  select 1
  from prompt_registry_events e
  where e.prompt_version = p.prompt_version
);
