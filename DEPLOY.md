# Deploy — Dev Console V1

## 1. Projeto separado

Publique este diretório em uma **nova Vercel**. A URL pode ser independente, por exemplo:

`https://sra-luck-dev.vercel.app`

Não é mais necessário publicar em `/dev-console` na mesma origem do sistema principal.

## 2. Supabase separado

Crie um novo projeto Supabase e execute:

1. `supabase/001_dev_console_base.sql`
2. crie o primeiro usuário no Supabase Auth;
3. execute `supabase/BOOTSTRAP_OWNER.sql` com o e-mail correto.

## 3. Variáveis da Vercel

Obrigatórias:

- `DEV_SUPABASE_URL`
- `DEV_SUPABASE_ANON_KEY`
- `DEV_SUPABASE_SERVICE_ROLE_KEY`
- `DEV_SESSION_SECRET`

Conector Sra Luck:

- `SRA_LUCK_BASE_URL=https://sra-luck-react.vercel.app`
- `SRA_LUCK_SERVICE_TOKEN`

GitHub opcional:

- `GITHUB_TOKEN`
- `GITHUB_REPOSITORY=Guidoka7/sra-luck-react`

## 4. Verificação do próprio Dev Console

Após deploy:

- `GET /api/dev-health` deve retornar 200;
- `GET /api/dev-ready` deve retornar 200 depois que Supabase/segredos estiverem configurados;
- `/login.html` deve autenticar o Owner;
- `/dev-acessos.html` deve listar o usuário;
- `/conexoes.html` deve mostrar Dev Supabase como conectado.

## 5. Conector Sra Luck

`/api/health` e `/api/ready` do Sra Luck podem ser consultados pelo proxy mesmo antes do token M2M.

As APIs administrativas só ficam operacionais quando o `sra-luck-react` implementar a validação server-to-server de `x-dev-console-token` usando o mesmo segredo configurado em `SRA_LUCK_SERVICE_TOKEN`.

Não usar:

- cookie `admin_session` compartilhado;
- e-mail/senha de administrador salvos na Vercel do Dev Console;
- service role do Supabase principal;
- CORS aberto para o Dev Console.

## 6. Segurança

- `dc_session` é HttpOnly;
- mutações locais validam Origin;
- RBAC é validado server-side;
- segredos ficam apenas nas Functions;
- mutações enviadas ao Sra Luck são auditadas no Supabase do Dev Console;
- o proxy não aceita destinos fora de `/api/*`;
- permissões do Dev Console são aplicadas antes do proxy.
