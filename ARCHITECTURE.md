# Arquitetura — Sra. Luck Dev Console

## Objetivo

O Dev Console é um produto separado do `sra-luck-react`. Ele existe para observar, diagnosticar e operar o ecossistema técnico da Sra. Luck sem duplicar regras de negócio no frontend e sem expor credenciais do sistema principal no navegador.

## Princípios

1. **Supabase próprio do Dev Console** para autenticação, RBAC, auditoria, incidentes, snapshots e estado dos agentes.
2. **Vercel própria** para páginas e Functions server-side.
3. **Conexão server-to-server** com o Sra Luck. O navegador nunca recebe `SRA_LUCK_SERVICE_TOKEN`.
4. **Sem acesso direto ao banco do Sra Luck pelo browser.** A fonte de verdade continua no sistema principal.
5. **Correções críticas passam pelas APIs/RPCs oficiais** do sistema principal.
6. **Telemetria técnica e auditoria de negócio são conceitos diferentes.**
7. **Saudável fica resumido. Exceção aparece.** O console prioriza manutenção, não quantidade de cards.

## Fluxo de autenticação

```text
Browser
  -> /api/auth/login
  -> Supabase Auth do Dev Console
  -> dev_users / RBAC
  -> cookie HttpOnly dc_session
  -> páginas protegidas
```

## Fluxo para o Sra Luck

```text
Browser autenticado
  -> /api/sra-proxy
  -> RBAC do Dev Console
  -> credencial M2M no backend
  -> sra-luck-react
  -> Worker / Supabase principal
```

## Fluxo de observabilidade

```text
Supabase / Vercel / Cloudflare / Sra Luck
        -> Functions do Dev Console
        -> Infrastructure & Resource Guardian
        -> dev_metric_snapshots / dev_infra_scans
        -> dev_incidents / dev_incident_events
        -> UI / alertas / runbooks
```

## Camadas

- `*.html`: interface estática e progressiva.
- `assets/`: shell, autenticação cliente, ícones e design system.
- `api/`: Vercel Functions e conectores server-side.
- `api/_lib/`: sessão, RBAC, Supabase, HTTP e infraestrutura.
- `supabase/`: migrations do banco exclusivo do Dev Console.
- `scripts/`: validações de repositório.
- `docs/qa/`: screenshots de referência visual sem dados reais.

## Áreas principais da interface

1. Visão Geral
2. Incidentes
3. Sistema Sra Luck
4. Infraestrutura
5. Notificações
6. Código & Releases
7. Acessos
8. Conexões

Telas detalhadas de Financeiro, V46, App/PWA, Integrações, Monitoramento e demais módulos continuam disponíveis como drill-down.
