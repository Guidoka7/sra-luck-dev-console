# API do Dev Console

As Functions desta pasta executam exclusivamente no backend da Vercel.

Principais grupos:

- `auth-*`: autenticação própria e sessão;
- `dev-*`: usuários, auditoria, health/readiness e status;
- `sra-proxy`: proxy RBAC server-to-server para o Sra Luck;
- `github-status`: leitura server-side de GitHub;
- `infra-*`: coleta e Guardian de infraestrutura.

Segredos ficam em `process.env` e nunca devem ser enviados ao browser.
