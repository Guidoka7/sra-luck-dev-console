# Contrato M2M — Dev Console → sra-luck-react

## Objetivo

Permitir que uma Vercel separada opere endpoints administrativos sem compartilhar cookie de usuário, senha administrativa ou service role do Supabase principal.

## Requisição enviada pelo Dev Console

Headers server-side:

- `x-dev-console-token: <segredo>`
- `x-dev-actor-id: <uuid do usuário no Dev Console>`
- `x-dev-actor-role: owner|developer|operator|viewer`
- `x-request-id: <uuid>`

## Validação necessária no sra-luck-react

O Worker principal deve:

1. aceitar autenticação M2M apenas em rotas explicitamente autorizadas;
2. comparar `x-dev-console-token` com `DEV_CONSOLE_SERVICE_TOKEN` usando comparação constante;
3. não aceitar o token em endpoints de cliente;
4. aplicar uma identidade de ator técnico distinta do admin humano tradicional;
5. manter RBAC/regras de negócio no backend principal;
6. registrar `x-dev-actor-id` e `request_id` em auditoria quando houver mutação;
7. nunca retornar o segredo ao frontend.

## Recomendação

Criar uma função de autorização específica, por exemplo `exigirAdminOuDevConsole()`, em vez de alterar `exigirAdmin()` globalmente. Isso reduz a superfície de acesso do conector.
