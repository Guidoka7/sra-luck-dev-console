-- Exclusivo do banco técnico do Console. Não armazena leads nem vendas.
create table public.dev_bi_oauth (
 provider text primary key check(provider='rd_station'), connection_id uuid not null,
 token_cipher jsonb not null, client_id text not null, expires_at timestamptz not null,
 version integer not null default 1, lock_owner uuid, lock_until timestamptz,
 updated_by text not null, updated_at timestamptz not null default now()
);
create table public.dev_bi_oauth_states (
 state_hash text primary key, actor_id text not null, session_id text not null, connection_id uuid not null,
 client_id text not null, redirect_uri text not null, expires_at timestamptz not null
);
create index dev_bi_oauth_state_expiry on public.dev_bi_oauth_states(expires_at);
create function public.dev_bi_claim_token(p_owner uuid) returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare r dev_bi_oauth;
begin
 update dev_bi_oauth set lock_owner=p_owner,lock_until=now()+interval '90 seconds'
 where provider='rd_station' and (lock_until is null or lock_until<now()) returning * into r;
 if not found then raise exception 'BI_TOKEN_BUSY'; end if;
 return to_jsonb(r);
end $$;
create function public.dev_bi_save_token(p_owner uuid,p_version integer,p_cipher jsonb,p_expires timestamptz) returns boolean language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 update dev_bi_oauth set token_cipher=p_cipher,expires_at=p_expires,version=version+1,lock_owner=null,lock_until=null,updated_at=now()
 where provider='rd_station' and lock_owner=p_owner and version=p_version and lock_until>now();
 if not found then raise exception 'BI_TOKEN_LEASE_LOST'; end if;
 return true;
end $$;
do $$ declare t text; f regprocedure;
begin
 foreach t in array array['dev_bi_oauth','dev_bi_oauth_states'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated',t);
  execute format('grant select,insert,update,delete on public.%I to service_role',t);
 end loop;
 for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname in ('dev_bi_claim_token','dev_bi_save_token') loop
  execute format('revoke all on function %s from public,anon,authenticated',f);
  execute format('grant execute on function %s to service_role',f);
 end loop;
end $$;
