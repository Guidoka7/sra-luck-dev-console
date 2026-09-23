begin;

create extension if not exists pgcrypto;

create table if not exists public.dev_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null unique,
  name text not null,
  role text not null default 'viewer' check (role in ('owner','developer','operator','viewer')),
  active boolean not null default true,
  permissions text[] not null default '{}',
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dev_users_role_active_idx on public.dev_users(role,active);

create table if not exists public.dev_auth_events (
  id uuid primary key default gen_random_uuid(),
  event text not null,
  actor_key text not null,
  email_hint text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists dev_auth_events_actor_time_idx on public.dev_auth_events(actor_key,created_at desc);

create table if not exists public.dev_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.dev_users(id) on delete set null,
  action text not null,
  resource text not null,
  resource_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists dev_audit_logs_time_idx on public.dev_audit_logs(created_at desc);
create index if not exists dev_audit_logs_actor_idx on public.dev_audit_logs(actor_user_id,created_at desc);

create table if not exists public.dev_incidents (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  title text not null,
  module text,
  severity text not null default 'warning' check (severity in ('info','warning','high','critical')),
  status text not null default 'open' check (status in ('open','investigating','mitigated','resolved','reopened')),
  occurrence_count integer not null default 1,
  affected_entities integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  assigned_to uuid references public.dev_users(id) on delete set null,
  source text,
  source_reference text,
  metadata jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dev_incidents_status_idx on public.dev_incidents(status,severity,last_seen_at desc);

create table if not exists public.dev_incident_events (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null references public.dev_incidents(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references public.dev_users(id) on delete set null,
  message text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists dev_incident_events_incident_idx on public.dev_incident_events(incident_id,created_at desc);

create table if not exists public.dev_job_runs (
  id uuid primary key default gen_random_uuid(),
  agent_key text not null,
  job_key text not null,
  run_id text,
  status text not null check (status in ('running','ok','warning','failed','skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_ms integer,
  processed_count integer,
  success_count integer,
  failure_count integer,
  details jsonb not null default '{}'::jsonb
);
create index if not exists dev_job_runs_job_idx on public.dev_job_runs(job_key,started_at desc);

create table if not exists public.dev_connectors (
  id uuid primary key default gen_random_uuid(),
  connector_key text not null unique,
  enabled boolean not null default true,
  status text not null default 'unknown' check (status in ('unknown','healthy','degraded','down','not_configured')),
  last_check_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dev_users enable row level security;
alter table public.dev_auth_events enable row level security;
alter table public.dev_audit_logs enable row level security;
alter table public.dev_incidents enable row level security;
alter table public.dev_incident_events enable row level security;
alter table public.dev_job_runs enable row level security;
alter table public.dev_connectors enable row level security;

revoke all on table public.dev_users from anon, authenticated;
revoke all on table public.dev_auth_events from anon, authenticated;
revoke all on table public.dev_audit_logs from anon, authenticated;
revoke all on table public.dev_incidents from anon, authenticated;
revoke all on table public.dev_incident_events from anon, authenticated;
revoke all on table public.dev_job_runs from anon, authenticated;
revoke all on table public.dev_connectors from anon, authenticated;

grant all on table public.dev_users to service_role;
grant all on table public.dev_auth_events to service_role;
grant all on table public.dev_audit_logs to service_role;
grant all on table public.dev_incidents to service_role;
grant all on table public.dev_incident_events to service_role;
grant all on table public.dev_job_runs to service_role;
grant all on table public.dev_connectors to service_role;

commit;
