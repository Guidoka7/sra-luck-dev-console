# Estado real do projeto

Atualizado após auditoria operacional em 23/09/2026.

> Regra: este documento deve descrever somente estados comprovados. Código existente não significa serviço ativo; configuração declarada não significa scheduler executando; health 200 não significa fluxo ponta a ponta validado.

## Produção confirmada

- repositório GitHub `Guidoka7/sra-luck-dev-console` existente;
- projeto Vercel `sra-luck-dev-console` existente;
- produção Vercel em estado `READY`;
- produção atualmente apontando para a `main` no commit `4dc9d8a0a12a3fd82901b38b05dfa50a6836160c`;
- `/api/dev-health` respondendo HTTP 200;
- `/api/dev-ready` respondendo HTTP 200 com ambiente e banco prontos;
- rotas técnicas protegidas exigindo sessão do Dev Console;
- Supabase exclusivo do Dev Console existente e `ACTIVE_HEALTHY`;
- autenticação/RBAC próprios do Dev Console em uso;
- proxy server-to-server com mutações auditadas para o Sra Luck;
- auditoria persistindo eventos reais;
- Infrastructure & Resource Guardian já executou varreduras reais e persistiu snapshots;
- telemetria de infraestrutura persistida em `dev_infra_scans` e `dev_metric_snapshots`.

## Banco do Dev Console confirmado

Migrations aplicadas:

1. `001_dev_console_base`
2. `002_infrastructure_observability`

Estruturas já existentes e utilizadas:

- `dev_users`;
- `dev_auth_events`;
- `dev_audit_logs`;
- `dev_incidents`;
- `dev_incident_events`;
- `dev_job_runs`;
- `dev_connectors`;
- `dev_infra_scans`;
- `dev_metric_snapshots`;
- `dev_resource_thresholds`.

O primeiro usuário técnico já existe. O banco possui registros reais de autenticação, auditoria e varreduras de infraestrutura.

## Em evolução na branch Claude — ainda não considerar produção

A branch `claude/pensive-heisenberg-wr49m7` está à frente da `main` e contém evoluções que ainda não devem ser descritas como produção apenas porque existem no código:

- Central de Problemas;
- visão de Agentes;
- explicações técnicas simplificadas;
- análise opcional por Gemini;
- APIs personalizadas;
- novos módulos/fluxos do Admin;
- novos logos e drawers de integrações;
- consolidação de rotas no `api/infra-scan.js`.

Os “agentes” dessa etapa são, em grande parte, visões especializadas sobre detectores/telemetria compartilhados. Não existem sete schedulers independentes. A execução automática continua centralizada no fluxo agendado do Dev Console.

## Pendências comprovadas

### CI

A `main` continua com o último workflow vermelho no commit atualmente em produção, porque ainda usa o estado anterior da base.

Falha registrada naquele commit:

- `Componente obrigatório ausente: history`
- `Componente obrigatório ausente: Dev Supabase provider`

A branch `claude/pensive-heisenberg-wr49m7` foi validada em execução real do GitHub Actions no run `35931735658`.

Resultado comprovado:

- `npm run check` — sucesso;
- `23 HTML` validados;
- `28 JS` validados;
- `12/12 Functions`;
- infraestrutura consolidada — PASS;
- verificação básica de segredos em `78 arquivos` — PASS.

O gatilho temporário usado apenas para provar o CI da branch foi removido após a execução. A promoção para a `main` ainda não foi feita.

### Migration 003

A migration:

`supabase/003_custom_apis.sql`

existe na branch de evolução, mas ainda não está aplicada no Supabase do Dev Console.

Portanto APIs personalizadas não devem ser apresentadas como persistência pronta em produção.

### Central de Problemas / autofix

`dev_job_runs` ainda não possui execuções persistidas.

Logo, a nova rotina `problems.autofix` não deve ser mostrada como scheduler comprovadamente ativo em produção.

### Scheduler

O `vercel.json` possui configuração de cron para `/api/infra-scan`.

Há varreduras reais do Infrastructure Guardian registradas no banco, porém ainda não foi comprovado nesta auditoria que todas elas vieram do cron automático da Vercel. Execução manual e execução agendada devem continuar diferenciadas.

### Cobertura de providers

Varreduras anteriores possuem dados reais de Supabase principal, Supabase Dev, Cloudflare, Vercel e runtime.

A varredura mais recente observada em ambiente de preview registrou somente Supabase Dev, runtime e Guardian. Não concluir indisponibilidade dos demais providers sem confirmar se as credenciais/variáveis também existem naquele ambiente.

## Segurança e governança a revisar

- o repositório está atualmente público;
- a branch `main` está atualmente sem proteção;
- a busca básica não encontrou padrões evidentes de PAT GitHub, token Vercel ou private key na branch padrão, mas isso não substitui secret scanning completo;
- mudanças administrativas de visibilidade/proteção não devem ser feitas automaticamente sem decisão explícita.

## Agentes / Guardians — classificação atual

### Infrastructure & Resource Guardian

**Implementado e com execuções reais confirmadas.**

Possui:

- persistência de scans;
- snapshots;
- thresholds;
- correlação com incidentes de infraestrutura;
- execução manual protegida;
- endpoint preparado para cron.

O cron automático ainda deve ser comprovado separadamente.

### Central de Problemas + agentes especializados

**Implementados na branch de evolução, ainda não comprovados em produção.**

A camada atual agrupa domínios como saúde, bugs, app, notificações, jornada/financeiro, integrações e infraestrutura. Ela usa detectores compartilhados e não deve ser descrita como sete agentes autônomos independentes.

### Autocorreção L2 da branch

O código limita autocorreção a ações marcadas explicitamente como seguras. Atualmente inclui verificações/reprocessamentos controlados de notificações e teste de conexão de integrações.

Liberação de acesso de cliente está marcada como não segura e não entra no autofix automático.

### Demais Guardians do roadmap

V46 Journey Guardian, Financial Integrity, Release Guardian, Security/Data Quality e outros continuam sendo evolução parcial ou futura até existir execução, telemetria e evidência persistida próprias.

## Runtime

Foi observado aviso recorrente de depreciação Node `DEP0169` relacionado a `url.parse()`.

Não foi encontrada chamada direta `url.parse(` no código da branch padrão durante a busca realizada. Tratar inicialmente como dívida técnica/transitiva e investigar a origem antes de alterar código.

Não classificar esse warning, isoladamente, como indisponibilidade do Dev Console.

## Próxima etapa recomendada

Antes da Árvore Operacional:

1. levar a base mais nova para uma validação CI real;
2. manter a `main` verde antes de novo deploy de produção;
3. aplicar a migration 003 somente quando o módulo correspondente for promovido;
4. provar scheduler e distinguir execução manual/cron;
5. garantir que a UI dos agentes reflita `executando / parcial / roadmap / sem scheduler` com base em evidência real;
6. só então iniciar a árvore piloto de um único fluxo crítico.

## Regra permanente

Quando uma fonte não estiver configurada, indisponível ou não puder ser comprovada, a UI deve mostrar isso explicitamente.

Nunca preencher números fictícios, presumir scheduler ativo, transformar health check em teste ponta a ponta ou tratar código presente como funcionalidade operacional comprovada.
