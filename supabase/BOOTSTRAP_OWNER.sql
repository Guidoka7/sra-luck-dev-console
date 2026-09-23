-- 1) Primeiro crie o usuário no Supabase Auth (Authentication > Users).
-- 2) Troque o e-mail abaixo pelo e-mail desse usuário e execute este SQL.
-- 3) Depois faça login normalmente no Dev Console.

insert into public.dev_users (auth_user_id,email,name,role,active)
select id,email,coalesce(raw_user_meta_data->>'name',split_part(email,'@',1)),'owner',true
from auth.users
where lower(email)=lower('SEU-EMAIL@EXEMPLO.COM')
on conflict (auth_user_id) do update
set role='owner',active=true,updated_at=now();
