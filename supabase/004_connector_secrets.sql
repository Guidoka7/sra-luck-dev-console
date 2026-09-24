-- Dev Console technical connector vault.
-- Bootstrap credentials for this Dev Supabase remain environment variables.
create table if not exists public.dev_connector_secrets (
  name text primary key check (name ~ '^[A-Z0-9_]{2,100}$'),
  value_cipher text not null,
  iv text not null,
  auth_tag text not null,
  updated_by text,
  updated_at timestamptz not null default now()
);

alter table public.dev_connector_secrets enable row level security;
revoke all on public.dev_connector_secrets from anon, authenticated;
grant all on public.dev_connector_secrets to service_role;

comment on table public.dev_connector_secrets is
  'Encrypted server-side credentials for Dev Console external connectors. Browser never reads plaintext.';
