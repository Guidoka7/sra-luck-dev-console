# Segurança

## Segredos

Nunca commitar:

- `DEV_SUPABASE_SERVICE_ROLE_KEY`
- `DEV_SESSION_SECRET`
- `SRA_LUCK_SERVICE_TOKEN`
- `GITHUB_TOKEN`
- `SRA_SUPABASE_ACCESS_TOKEN`
- `DEV_SUPABASE_ACCESS_TOKEN`
- `CLOUDFLARE_API_TOKEN`
- `VERCEL_ACCESS_TOKEN`
- `CRON_SECRET`

Use somente variáveis privadas da Vercel. Nenhuma delas deve usar prefixo público ou aparecer em HTML/JS do browser.

## Sessão

- cookie HttpOnly;
- SameSite=Lax;
- `Secure` em HTTPS;
- expiração controlada no backend;
- validação de origem em mutações;
- RBAC obrigatório nas Functions administrativas.

## M2M com Sra Luck

O token server-to-server é uma etapa inicial. Para produção endurecida, evoluir para assinatura por requisição com HMAC, timestamp, nonce e proteção de replay conforme `SRA-CONNECTOR-CONTRACT.md`.

## Supabase

O Supabase do Dev Console usa service role apenas dentro das Functions. As tabelas administrativas devem manter RLS e não conceder acesso direto a `anon`/`authenticated` quando a operação for exclusivamente server-side.

## Observabilidade

Nunca persistir em logs técnicos:

- senha;
- token;
- cookie;
- Authorization;
- service role;
- CPF completo;
- data de nascimento;
- dados de cartão;
- payload bruto de integração contendo PII.

O inspector de API da interface registra apenas metadados como método, rota, status, latência e request ID.

## Incidentes de segurança

Em caso de vazamento de segredo:

1. rotacionar imediatamente a credencial no provider;
2. atualizar a Vercel;
3. invalidar sessões se necessário;
4. revisar `dev_audit_logs` e logs do provider;
5. registrar incidente e causa raiz;
6. nunca reutilizar a credencial comprometida.
