# Sra. Luck Dev Console V1 — setup inicial

## 1. Criar o novo Supabase

No Supabase do **Dev Console**, execute:

`supabase/001_dev_console_base.sql`

Depois crie o primeiro usuário em **Authentication → Users** e execute `supabase/BOOTSTRAP_OWNER.sql`, trocando o e-mail.

O navegador não acessa tabelas do Dev Console diretamente. As tabelas têm RLS habilitado e `anon/authenticated` revogados; as Vercel Functions usam apenas `DEV_SUPABASE_SERVICE_ROLE_KEY` server-side.

## 2. Variáveis da nova Vercel

Copie `.env.example` e configure na Vercel:

- `DEV_SUPABASE_URL`
- `DEV_SUPABASE_ANON_KEY`
- `DEV_SUPABASE_SERVICE_ROLE_KEY`
- `DEV_SESSION_SECRET` — use valor aleatório forte, >= 32 bytes
- `SRA_LUCK_BASE_URL=https://sra-luck-react.vercel.app`
- `SRA_LUCK_SERVICE_TOKEN` — será compartilhado **somente entre os backends** quando o conector M2M for habilitado no Sra Luck
- `GITHUB_TOKEN` — opcional, server-side
- `GITHUB_REPOSITORY=Guidoka7/sra-luck-react`

## 3. Autenticação

Fluxo real:

`login.html → POST /api/auth/login → Supabase Auth → dev_users → cookie dc_session HttpOnly`

A sessão do Dev Console expira após 8 horas. O cookie é `HttpOnly`, `SameSite=Lax`, `Secure` em HTTPS e nunca contém senha/token do Supabase.

## 4. RBAC

Perfis:

- `owner`: controle completo, inclusive usuários e conexões.
- `developer`: incidentes, agentes, engenharia e correções.
- `operator`: monitoramento e correções operacionais autorizadas.
- `viewer`: leitura.

O backend revalida `dev_users.active`, role e permissões a cada chamada protegida.

## 5. Conector Sra Luck

As páginas continuam usando caminhos como `/api/admin/diagnostico`, mas `assets/dev-console-core.js` detecta que são APIs do Sra Luck e envia para:

`/api/sra-proxy?path=/api/admin/diagnostico`

O proxy:

1. valida a sessão do Dev Console;
2. aplica RBAC do Dev Console;
3. adiciona identidade técnica do operador;
4. adiciona `x-dev-console-token` server-side;
5. chama `SRA_LUCK_BASE_URL`;
6. devolve status/request ID ao navegador;
7. audita mutações.

Enquanto o `sra-luck-react` não validar `x-dev-console-token`, endpoints administrativos retornarão erro/401. Isso é intencional: não existe fallback inseguro por cookie ou senha compartilhada.

## 6. Primeiro acesso

1. Abra `/login.html`.
2. Entre com o Owner criado no Supabase novo.
3. Abra **Conexões Dev** para validar Supabase, health/ready do Sra Luck e configuração do token M2M.
4. Abra **Acessos Dev Console** para criar Developers/Operators/Viewers.

## Infraestrutura & Resource Guardian

Depois da migration base, aplique também:

`supabase/002_infrastructure_observability.sql`

Configure no projeto Vercel apenas no ambiente server-side:

```env
SRA_SUPABASE_PROJECT_REF=
SRA_SUPABASE_ACCESS_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_WORKER_SCRIPT=
VERCEL_ACCESS_TOKEN=
VERCEL_PROJECT_ID=
VERCEL_TEAM_ID=
CRON_SECRET=
```

O Supabase token deve ter capacidade de leitura das APIs de Analytics/Metrics/Logs. O Cloudflare token deve permitir leitura do Workers Analytics GraphQL para a conta. Não exponha esses tokens ao frontend.

O endpoint `POST /api/infra-scan` está pronto para scheduler. Ao configurar um scheduler externo/Vercel Cron, envie `Authorization: Bearer <CRON_SECRET>` e use uma cadência compatível com o plano e com a granularidade das fontes (o Supabase Metrics atualiza em ~1 minuto).


## Observabilidade de infraestrutura

Para monitorar também recursos do Supabase do Sra Luck e do próprio Supabase Dev, adicione somente na Vercel:

```env
SRA_SUPABASE_PROJECT_REF=
SRA_SUPABASE_ACCESS_TOKEN=
DEV_SUPABASE_PROJECT_REF=
DEV_SUPABASE_ACCESS_TOKEN=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_WORKER_SCRIPT=
VERCEL_ACCESS_TOKEN=
VERCEL_PROJECT_ID=
VERCEL_TEAM_ID=
CRON_SECRET=
```

Aplique também `supabase/002_infrastructure_observability.sql`.

O endpoint `/api/infra-scan` aceita POST autenticado pelo Dev Console e GET exclusivamente com `Authorization: Bearer $CRON_SECRET`, permitindo um scheduler externo ou Vercel Cron. Não adicione uma frequência subdiária em `vercel.json` se o projeto estiver no plano Hobby da Vercel.
