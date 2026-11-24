create table if not exists prompt_registry (
  prompt_version text primary key,
  name text not null,
  owner text,
  description text,
  status text not null default 'active' check (
    status in ('active', 'deprecated')
  ),
  created_by_subject text not null,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists prompt_registry_status_idx
  on prompt_registry (status, prompt_version);
