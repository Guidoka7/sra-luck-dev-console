# API Map — Dev Console V1

## APIs próprias

### Autenticação

- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `POST /api/auth/forgot`
- `POST /api/auth/reset`

### Control plane

- `GET|POST|PATCH /api/dev-users`
- `GET /api/dev-audit`
- `GET /api/dev-status`
- `GET /api/dev-health`
- `GET /api/dev-ready`
- `GET /api/github-status?resource=summary|overview|branches|workflows|changes` — `code.view`
  - `changes`: últimos commits e CI da main do Sra Luck, migrations presentes no repositório (a aplicação no banco é manual e não é afirmada), deploys da Vercel e `sincronia` (`sincronizado` | `producao_atras` com `commitsAtras` | `divergente` | `desconhecido` + `motivo`). Usado pela Visão Geral.
- `POST /api/github-status` `{ action: rerun_failed|merge_pr|create_pr|dispatch_workflow|redeploy|promote, repo: sra|console, ... }` — `releases.manage` (developer/owner), auditado

### Proxy

- `GET|HEAD|POST|PATCH|PUT|DELETE /api/sra-proxy?path=/api/...`

O frontend normalmente não chama o proxy diretamente. `DC.api('/api/admin/...')` faz o roteamento automaticamente.

## Permissões do proxy

Exemplos:

- monitoramento/diagnóstico → `monitoring.view`
- Jornada V46 leitura → `v46.inspect`
- Jornada V46 mutação → `v46.correct`
- Financeiro leitura → `finance.inspect`
- Financeiro mutação → `finance.correct`
- App leitura → `app.inspect`
- liberação/correção do App → `app.correct`
- Notificações leitura → `notifications.view`
- Notificações mutação → `notifications.manage`
- Integrações leitura → `integrations.view`
- Integrações mutação → `integrations.manage`

A autorização real do Sra Luck continua existindo do outro lado; o RBAC do Dev Console é uma camada adicional, não substituta.

## Central de Problemas

- `GET /api/problemas` — detecta problemas em plataforma, Admin, App da cliente, notificações, V46, financeiro e integrações (`monitoring.view`).
  - cada problema com incidente aberto em `dev_incidents` traz `incidente: { status, desde, ultimaVez, varreduras }`; `desde` só é preenchido quando o incidente está aberto (um incidente reaberto não serve de início). A Visão Geral usa `desde` para cruzar o problema com deploys e migrations.
- `GET /api/incidentes?dias=7` — incidentes abertos/mitigados e os atualizados no período (até 30 dias), eventos (sem `signal_repeated`), responsáveis possíveis, `podeGerenciar` e `eu` (`monitoring.view`). Mora em `api/infra-scan.js` (`mode=incidents`).
- `POST /api/incidentes` `{ ids, acao: status|responsavel|nota, status?: investigating|mitigated|resolved, usuario?, nota? }` — muda só o acompanhamento no banco do Dev Console, até 20 incidentes por vez (um grupo), com evento e auditoria (`incidents.manage`, mesma origem).
- `GET /api/problemas?incidente=problem:…|infra:…` — incidente registrado e seus eventos (`opened`, `signal_repeated`, `signal_recovered`, `reopened`, `fix_applied`) para a linha do tempo (`monitoring.view`).
- `POST /api/problemas` `{ teste }` — reteste de um único teste da Central (ids de `SOURCES` em `api/_lib/problems.js`). É o mesmo GET da varredura, só leitura no Sra Luck; o resultado é gravado em `dev_metric_snapshots` como `probe` com `dimensions.manual=true` (`monitoring.view`, mesma origem).
- `POST /api/problemas` — `{ problema, acao, params? }` aplica uma correção do registro fechado e verifica se o problema sumiu. A permissão depende da ação:
  - `notificacoes.verificar_atrasos` / `notificacoes.verificar_vencimentos` → `notifications.manage` (seguro, L2)
  - `integracoes.testar` → `integrations.manage` (seguro, L2)
  - `app.liberar_acesso` → `app.correct` (confirmação humana, L3, até 25 clientes por vez)

Mora em `api/infra-scan.js` (`mode=problems`) por causa do limite de Functions do plano Hobby.

## Agentes

- `GET /api/agentes` — resumo do dia, agentes, novidades boas e ruins, correções recentes (`monitoring.view`)
- `POST /api/agentes` `{ action: "analisar", problema }` — análise por IA do problema (Gemini, opcional)

## Padrão de integrações (via proxy do Sra Luck)

- `GET /api/sra-proxy?path=/api/admin/integrations/catalogo` — registro de cada integração do Sra Luck (`worker/integracoes-registro.ts`): credenciais (só chave, rótulo e obrigatoriedade, nunca valores), funções com situação real (`disponivel`, `api_permite`, `api_nao_permite` + motivo), origem e destino, mapeamento de campos, modos de sincronização, webhooks de entrada/saída, limites e regras; funções configuráveis trazem `config`, `versao`, `atualizadoEm` e `usoHoje` (`integrations.view`).
- `POST /api/sra-proxy?path=/api/admin/integrations/config` `{ provedor, funcao, config, versao }` — grava a configuração **não secreta** de uma função (hoje: Gemini `mensagem_diaria` e `notificacoes`: `ativo`, `modelo`, `prompt`, `temperatura`, `maxTokens`, `limiteDiario`). Versão otimista (409 em conflito) e auditoria no Sra Luck. Dev Console: `integrations.manage`; guarda M2M do Sra Luck: só owner/developer e só essas chaves.
- Sem o catálogo em produção (404), `integracoes.html` avisa e abre o drawer no formato anterior.
- Segredos continuam só no cofre cifrado do Sra Luck, editados no Admin; o Dev Console mostra origem e máscara.

## APIs personalizadas

- `GET /api/custom-apis` (`?check=1` testa todas) — `integrations.view`
- `POST /api/custom-apis` `{ action: save|toggle|delete, ... }` — `integrations.manage`; `{ action: test, id }` — `integrations.view`

Só HTTPS público (endereços privados/internos bloqueados, sem seguir redirecionamentos). O segredo opcional vem de uma variável de ambiente `CUSTOM_API_*`; nada sensível fica no banco. Tabela: `supabase/003_custom_apis.sql`.

## Infraestrutura & recursos

### Dev Console
- `GET /api/infra-overview` — visão consolidada de infraestrutura
- `GET /api/infra-supabase?hours=1|6|24` — métricas + erros do Supabase Sra Luck
- `GET /api/infra-dev-supabase` — saúde/métricas do Supabase próprio do Dev Console
- `GET /api/infra-history?source=&metric=&hours=` — histórico persistido de recursos
- `GET /api/infra-history?series=fonte:metrica,...&hours=` — várias séries de uma vez (até 16), usado pelos gráficos de memória e pela Visão Geral (`probe:<fluxo>` = latência real de cada fluxo testado, em ms, gravada a cada varredura); cada ponto traz `metric_value`, `state`, `observed_at` e `dimensions` (status HTTP, reteste manual)
- `GET /api/infra-cloudflare` — Worker CPU/memory/request/error metrics
- `GET /api/infra-vercel` — deploys Vercel + runtime atual
- `GET /api/infra-runtime` — memória do runtime atual do Dev Console
- `POST /api/infra-scan` — execução manual do Infrastructure & Resource Guardian (RBAC `agents.run`)
- `GET /api/infra-scan` — execução por scheduler autenticado com `Authorization: Bearer $CRON_SECRET`

Permissão de leitura: `infrastructure.view`.
Execução do Guardian: `agents.run`.

### Provedores externos server-side
- Supabase Management API: `/v1/projects/{ref}/analytics/endpoints/metrics`
- Supabase Management API: `/v1/projects/{ref}/analytics/endpoints/logs`
- Cloudflare GraphQL: `workersInvocationsAdaptive`
- Vercel REST API: lista de deployments do projeto configurado
