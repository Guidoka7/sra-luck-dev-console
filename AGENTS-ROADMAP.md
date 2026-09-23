# Evolutivo oficial — Agentes do Sra. Luck Dev Console

Este documento registra o roadmap acordado para o novo control plane.

## Primeira onda

1. **System Health Agent** — saúde de API, banco, dependências, latência e heartbeat.
2. **Incident Manager Agent** — agrupa erros, cria incidentes, acompanha ciclo de vida e recorrência.
3. **V46 Journey Guardian** — detecta clientes presas/estados incoerentes e aciona reprocessamentos seguros.
4. **Financial Integrity Agent** — detecta divergências de boleto, recebimento, comprovante, duplicidade e forecast financeiro.
5. **Notification Delivery Agent** — controla elegibilidade, deduplicação, Web Push, retries, subscriptions inválidas e DLQ.
6. **Integration Reliability Agent** — acompanha RD, Mercado Pago, Conta Azul e demais providers, com retry/circuit breaker.
7. **Job & Queue Supervisor** — heartbeat de cron/jobs, filas, retries e dead letters.

## Segunda onda

8. **Release Guardian Agent** — correlação deploy/SHA x regressões.
9. **Security & Access Agent** — autenticação, RBAC e sinais de abuso.
10. **App Experience Agent** — versão/PWA/Push/erros por build e dispositivo.
11. **Data Quality Agent** — invariantes e inconsistências silenciosas do banco.
12. **Audit & Change Agent** — fiscaliza alterações críticas e correções.

## Orquestrador futuro

**Sra. Luck Operations Agent**: interpreta os sinais dos agentes especializados, prioriza impacto e sugere ações. Não altera dados diretamente; chama ferramentas/agentes com autonomia limitada.

## Níveis de autonomia

- **L0 — Observação:** detectar e registrar.
- **L1 — Diagnóstico:** probes/consultas sem mutação.
- **L2 — Autocorreção segura:** retry, reprocessamento idempotente, limpeza de subscription inválida etc.
- **L3 — Aprovação humana:** financeiro sensível, V46 crítico, RBAC, deploy/rollback.

## Diretriz arquitetural

A inteligência/execução 24x7 deve ficar server-side. O Dev Console é o control plane: autentica, visualiza, autoriza, aciona e audita. O `sra-luck-react` continua sendo a fonte de verdade das regras de negócio.

## Central de Problemas — IMPLEMENTADA

Primeira versão combinada de System Health, Incident Manager, Notification Delivery, V46 Journey Guardian (detecção), Financial Integrity (fila de validação) e App Experience. Autonomia: L2 para rotinas idempotentes e testes de integração; L3 (confirmação humana) para liberação de acesso ao app; link para decisões de V46 e financeiro.

## Infrastructure & Resource Guardian — IMPLEMENTADO NA BASE V1

Responsabilidade: observar recursos e diferenciar falha de código de pressão de infraestrutura.

Fontes iniciais:
- Supabase Metrics + Logs
- Cloudflare Worker Analytics
- Vercel Deployments
- Dev Console runtime memory
- App/PWA telemetry

Autonomia atual:
- L0 observação
- L1 diagnóstico
- persistência de snapshots
- abertura/atualização de incidentes após condição sustentada
- mitigação automática do incidente quando o sinal recupera

Não altera plano, compute, banco ou regras de negócio automaticamente.


### Infrastructure & Resource Guardian — cobertura V1

- disponibilidade dos providers configurados;
- Supabase Sra Luck e Supabase Dev separados;
- RAM, swap, disco, CPU e I/O;
- OOM kills e reinícios Postgres entre varreduras;
- memória por serviço e sinais de pool/conexões quando expostos;
- Worker memory P99, CPU, requests e error rate;
- Dev Runtime RSS/limite configurado;
- histórico e thresholds sustentados;
- criação/mitigação de incidentes de infraestrutura.
