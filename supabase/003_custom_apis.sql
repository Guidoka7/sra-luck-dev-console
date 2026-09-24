begin;

-- APIs personalizadas monitoradas pelo Dev Console.
-- Segredos nunca ficam aqui: header_env guarda só o NOME de uma variável de
-- ambiente CUSTOM_API_* da Vercel, lida no backend na hora do teste.
create table if not exists public.dev_custom_apis (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  description text,
  base_url text not null check (base_url ~ '^https://'),
  health_path text not null default '/' check (health_path ~ '^/'),
  method text not null default 'GET' check (method in ('GET', 'HEAD')),
  expected_status integer not null default 200 check (expected_status between 100 and 599),
  timeout_ms integer not null default 8000 check (timeout_ms between 1000 and 20000),
  header_name text check (header_name is null or header_name ~ '^[A-Za-z0-9-]{1,60}$'),
  header_env text check (header_env is null or header_env ~ '^CUSTOM_API_[A-Z0-9_]{1,60}$'),
  enabled boolean not null default true,
  last_check_at timestamptz,
  last_ok boolean,
  last_status integer,
  last_ms integer,
  last_error text,
  created_by uuid references public.dev_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dev_custom_apis enable row level security;
revoke all on table public.dev_custom_apis from anon, authenticated;
grant all on table public.dev_custom_apis to service_role;

commit;
