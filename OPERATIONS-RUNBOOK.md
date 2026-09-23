# Runbook de operação

## Ordem de investigação

Quando houver falha percebida no Sra Luck:

1. **Visão Geral** — verificar atenção necessária.
2. **Incidentes** — procurar incidente já agrupado.
3. **Infraestrutura** — confirmar hosting, banco, Worker e runtime.
4. **Sistema Sra Luck** — localizar domínio afetado.
5. **Logs/trace** — usar request ID e endpoint.
6. **Correção segura** — somente ação suportada por API oficial.
7. **Validação pós-correção** — health/readiness + rota afetada.
8. **Resolver incidente** somente após estabilidade confirmada.

## Banco degradado

Verificar RAM, swap, CPU, disco, I/O, conexões, logs, OOM kills e reinícios do Postgres. Não concluir indisponibilidade apenas porque a API de métricas está fora; correlacionar com health/readiness.

## Web Push

Separar falha da automação da falha do canal:

- audiência elegível;
- notificação criada;
- subscription ativa;
- tentativa de envio;
- erro do provider;
- retry/DLQ.

## V46

Antes de qualquer correção verificar:

- termos;
- comparecimento;
- quitação;
- prazo;
- `agenda_cirurgica_liberada_em`;
- data de cirurgia;
- execução recente do job V46.

Nunca corrigir estado por SQL manual no Dev Console quando existir RPC/API oficial.

## Financeiro

Operações de baixa, comprovante e edição devem manter idempotência, auditoria e permissões. Divergência financeira deve ser investigada antes de reprocessamento.
