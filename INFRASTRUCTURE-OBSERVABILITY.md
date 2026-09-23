# Infrastructure & Resource Guardian

## Objetivo

Centralizar observabilidade de infraestrutura do ecossistema Sra Luck sem inventar métricas e sem expor credenciais no navegador. O módulo separa claramente quatro fontes:

1. Supabase do Sra Luck
2. Supabase próprio do Dev Console
3. Cloudflare Worker
4. Vercel / runtime do Dev Console
5. App/PWA via telemetria do próprio Sra Luck

## Supabase

Fonte oficial: Supabase Management API.

- Métricas: `GET /v1/projects/{ref}/analytics/endpoints/metrics`
- Logs: `GET /v1/projects/{ref}/analytics/endpoints/logs`

O endpoint de logs usado é o endpoint unificado atual; `logs.all` não é utilizado.

Sinais derivados:

- RAM total, disponível, usada, cache e buffers
- swap total/usado
- disco total/usado
- load 1/5/15
- OOM kills
- reinicializações Postgres
- I/O em andamento
- CPU entre scrapes consecutivos
- read/write operations por segundo entre scrapes
- catálogo de sinais de conexão/pool quando expostos
- erros Postgres e edge 5xx

CPU e IOPS não são estimados a partir de um único scrape. O primeiro scan aquece o histórico; o segundo e seguintes calculam deltas.

## Supabase do Dev Console

O banco de controle também é monitorado. O probe de disponibilidade usa `DEV_SUPABASE_URL` + `DEV_SUPABASE_SERVICE_ROLE_KEY`. Para recursos físicos/lógicos do projeto, configure também:

```env
DEV_SUPABASE_PROJECT_REF=
DEV_SUPABASE_ACCESS_TOKEN=
```

Quando as credenciais de Management API estão presentes, o painel passa a mostrar RAM, swap, disco, CPU, I/O, memória por serviço e histórico do próprio banco do Dev Console. Sem elas, o banco continua sendo verificado por disponibilidade, mas nenhuma métrica de memória é inventada.

## Histórico de recursos

O Guardian grava amostras em `dev_metric_snapshots`. A tela permite alternar entre RAM, CPU, disco, swap, memória P99 do Worker, taxa de erro do Worker e heap do Dev Console, com janelas de 6h, 24h, 7 dias e 30 dias.

A avaliação de sustentação usa os snapshots já persistidos. O snapshot corrente não é contado duas vezes.

## Cloudflare Worker

Fonte oficial: Cloudflare GraphQL Analytics API, dataset `workersInvocationsAdaptive`.

Coletado em janela de 15 minutos:

- requests
- errors
- subrequests
- CPU P50/P99
- memória P50/P90/P99/P999

A memória P99 é comparada ao limite de 128 MB por isolate. Se a API GraphQL não estiver configurada, o painel exibe `Não configurado` e não gera valores sintéticos.

## Vercel

A integração atual coleta histórico de deploys via REST API e mede o runtime da Function do próprio Dev Console com `process.memoryUsage()`.

O Dev Console não tenta reconstruir métricas históricas avançadas de Vercel Functions quando não há uma API/export de Observability configurada. Nessa situação, a interface declara explicitamente a limitação.

Runtime atual do Dev Console:

- RSS
- heap total
- heap usado
- percentual heap usado/heap alocado (diagnóstico; não abre incidente)
- RSS e, quando `DEV_FUNCTION_MEMORY_LIMIT_MB` é configurado, RSS/limite para alertas sustentados
- memória external
- ArrayBuffers
- Node version
- region/environment

## App/PWA

Consome o endpoint oficial do Sra Luck:

`GET /api/admin/monitoramento-app`

Exibe PWA, Push, dispositivos e acessos existentes. Versão/build, Web Vitals e memória de navegador permanecem como evolutivos até a telemetria correspondente existir no sistema principal.

## Persistência no Supabase do Dev Console

Migration: `supabase/002_infrastructure_observability.sql`

Cria:

- `dev_infra_scans`
- `dev_metric_snapshots`
- `dev_resource_thresholds`

Também cria `dev_prune_infra_history(days)` para retenção controlada.

## Infrastructure Guardian

Endpoint:

`POST /api/infra-scan` para execução manual e `GET /api/infra-scan` para scheduler.

A execução manual exige `agents.run`. A execução GET é aceita apenas quando o header `Authorization` contém `Bearer <CRON_SECRET>`. Isso é compatível com Vercel Cron; a frequência deve respeitar o plano da Vercel. Em Hobby o cron só pode rodar uma vez por dia; Pro/Enterprise permitem frequência por minuto.

Fluxo:

1. consulta provedores configurados;
2. calcula sinais normalizados;
3. persiste snapshots;
4. aplica thresholds;
5. verifica se a condição permaneceu ruim pelo período configurado;
6. só então cria/atualiza `dev_incidents`;
7. quando o sinal volta ao normal, move incidente aberto para `mitigated`;
8. resolução final continua humana.

Isso evita incidentes por picos isolados. Falha na Management API do Supabase ou GraphQL Analytics da Cloudflare é classificada como falha da **fonte de observabilidade**; ela não é tratada, isoladamente, como prova de que o banco ou Worker estejam fora do ar. A disponibilidade funcional continua sendo correlacionada com health/readiness e endpoints do sistema.

## Thresholds iniciais

- Supabase RAM: warning 85%, critical 92%, sustentação 15 min
- Supabase swap: warning 5%, critical 20%, sustentação 15 min
- Supabase disk: warning 75%, critical 85%, sustentação 1 h
- Supabase CPU: warning 80%, critical 92%, sustentação 15 min
- Supabase Dev RAM/swap/disco/CPU: mesmos thresholds iniciais do banco principal, armazenados separadamente
- Worker memory P99: warning 75%, critical 90% do limite, sustentação 10 min
- Worker error rate: warning 1%, critical 5%, sustentação 5 min
- Dev Console RSS/limite: warning 75%, critical 90%, sustentação 10 min; só ativo quando `DEV_FUNCTION_MEMORY_LIMIT_MB` informa o limite real

Os thresholds vivem no banco e podem ser evoluídos sem alterar o frontend.

## Variáveis server-side

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
DEV_FUNCTION_MEMORY_LIMIT_MB=
```

Nenhuma dessas variáveis deve usar prefixo público nem ser entregue ao browser.
