begin;

create table if not exists public.dev_infra_scans (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  status text not null default 'unknown' check (status in ('healthy','warning','critical','degraded','down','unknown','not_configured')),
  summary jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists dev_infra_scans_source_time_idx on public.dev_infra_scans(source, observed_at desc);

create table if not exists public.dev_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  metric_key text not null,
  metric_value double precision,
  unit text,
  state text not null default 'unknown' check (state in ('healthy','warning','critical','unknown')),
  dimensions jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now()
);
create index if not exists dev_metric_snapshots_lookup_idx on public.dev_metric_snapshots(source, metric_key, observed_at desc);

create table if not exists public.dev_resource_thresholds (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  metric_key text not null,
  label text not null,
  warning_value double precision,
  critical_value double precision,
  comparator text not null default 'gte' check (comparator in ('gte','lte')),
  sustain_seconds integer not null default 900 check (sustain_seconds >= 0),
  enabled boolean not null default true,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source, metric_key)
);

insert into public.dev_resource_thresholds(source,metric_key,label,warning_value,critical_value,comparator,sustain_seconds,description) values
 ('supabase','provider_unavailable','Supabase Sra Luck · observabilidade',1,1,'gte',300,'A fonte Management/Metrics API deixou de responder de forma sustentada; não implica, isoladamente, indisponibilidade do banco.'),
 ('supabase','memory_usage_percent','Supabase · RAM',85,92,'gte',900,'Pressão sustentada de memória do Postgres.'),
 ('supabase','swap_usage_percent','Supabase · Swap',5,20,'gte',900,'Uso sustentado de swap pode indicar pressão de RAM.'),
 ('supabase','disk_usage_percent','Supabase · Disco',75,85,'gte',3600,'Capacidade de disco utilizada.'),
 ('supabase','cpu_usage_percent','Supabase · CPU',80,92,'gte',900,'CPU derivada entre dois scrapes consecutivos.'),
 ('supabase','oom_kills_delta','Supabase · OOM kill',1,1,'gte',0,'Novo OOM kill detectado entre varreduras.'),
 ('supabase','postgres_restarts_delta','Supabase · reinícios Postgres',1,3,'gte',0,'Reinícios do Postgres detectados entre varreduras.'),
 ('dev_supabase','provider_unavailable','Supabase Dev Console · banco de controle',1,1,'gte',300,'O probe REST do banco de controle deixou de responder de forma sustentada.'),
 ('dev_supabase','memory_usage_percent','Supabase Dev · RAM',85,92,'gte',900,'Pressão sustentada de memória do banco do Dev Console.'),
 ('dev_supabase','swap_usage_percent','Supabase Dev · Swap',5,20,'gte',900,'Uso sustentado de swap no banco do Dev Console.'),
 ('dev_supabase','disk_usage_percent','Supabase Dev · Disco',75,85,'gte',3600,'Capacidade de disco do banco do Dev Console.'),
 ('dev_supabase','cpu_usage_percent','Supabase Dev · CPU',80,92,'gte',900,'CPU do banco do Dev Console derivada entre scrapes.'),
 ('dev_supabase','oom_kills_delta','Supabase Dev · OOM kill',1,1,'gte',0,'Novo OOM kill detectado no banco do Dev Console.'),
 ('dev_supabase','postgres_restarts_delta','Supabase Dev · reinícios Postgres',1,3,'gte',0,'Reinícios do Postgres do Dev Console detectados.'),
 ('cloudflare','provider_unavailable','Cloudflare Worker · Analytics',1,1,'gte',300,'A fonte GraphQL Analytics deixou de responder; investigar credencial/API sem concluir que o Worker está fora do ar.'),
 ('cloudflare','worker_memory_p99_percent','Worker · Memória P99',75,90,'gte',600,'Percentil P99 relativo ao limite de 128 MB por isolate.'),
 ('cloudflare','worker_error_rate_percent','Worker · Taxa de erro',1,5,'gte',300,'Erros / requests no intervalo observado.'),
 ('dev_runtime','rss_usage_percent','Dev Console · RSS',75,90,'gte',600,'RSS comparado a DEV_FUNCTION_MEMORY_LIMIT_MB; só existe quando o limite real é configurado.')
on conflict(source,metric_key) do nothing;

alter table public.dev_infra_scans enable row level security;
alter table public.dev_metric_snapshots enable row level security;
alter table public.dev_resource_thresholds enable row level security;

revoke all on table public.dev_infra_scans from anon, authenticated;
revoke all on table public.dev_metric_snapshots from anon, authenticated;
revoke all on table public.dev_resource_thresholds from anon, authenticated;

grant all on table public.dev_infra_scans to service_role;
grant all on table public.dev_metric_snapshots to service_role;
grant all on table public.dev_resource_thresholds to service_role;

create or replace function public.dev_prune_infra_history(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer := 0;
  n integer := 0;
begin
  delete from public.dev_metric_snapshots where observed_at < now() - make_interval(days => greatest(1,p_days));
  get diagnostics n = row_count; removed := removed + n;
  delete from public.dev_infra_scans where observed_at < now() - make_interval(days => greatest(1,p_days));
  get diagnostics n = row_count; removed := removed + n;
  return removed;
end;
$$;

revoke all on function public.dev_prune_infra_history(integer) from public, anon, authenticated;
grant execute on function public.dev_prune_infra_history(integer) to service_role;

commit;
