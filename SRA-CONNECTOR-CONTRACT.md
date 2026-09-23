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

## Correções (escrita)

O conector aceita mutações somente quando `DEV_CONSOLE_M2M_WRITE=1` está definido no `sra-luck-react` e a rota está na allowlist fechada de `worker/dev-console-auth.ts`:

- V46: `POST /api/admin/central/{comparecimento,quitacao,liberar-tentativa,prazo/ajustar,prazo/liberar-agora,cirurgia/pagamento}`
- Financeiro: validar/rejeitar comprovante, baixa, anexar comprovante e `PATCH` do recebível
- App: `POST /api/admin/clientes/:id/liberar-acesso-app`
- Notificações: `POST /api/admin/notificacoes/automacao`
- Integrações: `POST /api/admin/integrations/testar-conexao`
- Clube: config, indicações, vouchers e recompensas

Toda correção exige `x-dev-actor-role` = `operator`, `developer` ou `owner` e gera `logs_alteracoes.acao = dev_console_correcao`. Equipe/RBAC, credenciais, rotação VAPID, configurações, contratos e carnês continuam bloqueados.

Códigos de recusa: `DEV_CONSOLE_M2M_READ_ONLY` (escrita desligada), `DEV_CONSOLE_MUTATION_NOT_ALLOWED` (rota fora da lista), `DEV_CONSOLE_ROLE_INSUFFICIENT` (papel insuficiente).

## Recomendação

Criar uma função de autorização específica, por exemplo `exigirAdminOuDevConsole()`, em vez de alterar `exigirAdmin()` globalmente. Isso reduz a superfície de acesso do conector.
