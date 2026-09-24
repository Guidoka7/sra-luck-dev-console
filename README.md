# Sra. Luck Dev Console

Central técnica separada para **monitorar, diagnosticar e manter** o ecossistema Sra. Luck.

O objetivo não é reproduzir o Admin do negócio. O Dev Console existe para responder rapidamente:

- o sistema está saudável?
- o que exige atenção agora?
- qual domínio está falhando?
- banco/hospedagem/runtime estão pressionados?
- qual incidente agrupa os erros?
- qual ação segura pode corrigir?
- a correção funcionou?

## Estado atual

Este pacote contém a base completa do novo repositório: frontend, Vercel Functions, autenticação própria, RBAC, migrations, infraestrutura, incidentes, documentação e CI.

**Ainda é necessário criar e configurar os ambientes externos** (GitHub, Supabase Dev, Vercel Dev e conector M2M com o `sra-luck-react`). Veja `PROJECT-STATUS.md`.

Baseline do sistema principal conferida nesta entrega: `Guidoka7/sra-luck-react` `main` em `accbff2fda17fdbc3a38564629926e9815ef2210`.

## Navegação principal

A interface foi simplificada para manutenção diária:

1. **Visão Geral** — somente estado, exceções e atenção necessária.
2. **Central de Problemas** — tudo o que está falhando, com a correção ao lado e verificação automática.
3. **Incidentes** — erros agrupados, recorrência, impacto e runbooks.
4. **Sistema Sra Luck** — entrada para V46, Financeiro, App/PWA e integrações.
5. **Infraestrutura** — Supabase, Vercel, Cloudflare e runtime.
6. **Notificações** — automação, Web Push e falhas.
7. **Código & Releases** — SHA, CI, deploys e regressões.
8. **Acessos** — usuários técnicos e RBAC do Dev Console.
9. **Conexões** — estado/configuração das fontes externas.

As telas detalhadas continuam no projeto como drill-down e não precisam poluir a navegação principal.

## Arquitetura

```text
Browser
  -> Dev Console / Vercel
       -> Supabase Dev Console
       -> GitHub API (server-side)
       -> Supabase Management API
       -> Cloudflare Analytics
       -> Vercel API
       -> Proxy M2M
            -> sra-luck-react
                 -> Worker / Supabase principal
```

Leia `ARCHITECTURE.md` antes de evoluir integrações.

## Autenticação

O Dev Console não reutiliza o `admin_session` do Sra Luck.

Fluxo:

```text
Browser
 -> /api/auth/login
 -> Supabase Auth Dev
 -> dev_users / RBAC
 -> cookie HttpOnly dc_session
```

Perfis iniciais:

- `owner`
- `developer`
- `operator`
- `viewer`

## Banco próprio

Aplique no **Supabase exclusivo do Dev Console**:

1. `supabase/001_dev_console_base.sql`
2. `supabase/002_infrastructure_observability.sql`
3. crie o primeiro usuário no Supabase Auth
4. adapte e execute `supabase/BOOTSTRAP_OWNER.sql`

## Infraestrutura monitorada

O módulo `infraestrutura.html` já possui conectores para:

- Supabase do Sra Luck;
- Supabase do Dev Console;
- Cloudflare Worker;
- Vercel;
- runtime Node/Vercel Function;
- histórico de métricas;
- thresholds sustentados;
- criação/mitigação automática de incidentes pelo Infrastructure Guardian.

Detalhes: `INFRASTRUCTURE-OBSERVABILITY.md`.

## Variáveis

Use `.env.example` como inventário. Nunca commite o arquivo real de segredos.

## Desenvolvimento

```bash
npm run check
npx vercel dev
```

Leia `LOCAL-DEVELOPMENT.md`.

## Validação

```bash
npm run check
```

O workflow `.github/workflows/validate.yml` executa a mesma validação no GitHub.

## Primeira publicação

Siga `REPOSITORY-CHECKLIST.md` e `SETUP-V1.md`.

## Operação

Use `OPERATIONS-RUNBOOK.md` para a ordem recomendada de investigação e correção.

## Segurança

Leia `SECURITY.md`. Credenciais do Sra Luck, Supabase, GitHub, Cloudflare e Vercel ficam exclusivamente server-side.

## Roadmap

Os agentes especializados estão documentados em `AGENTS-ROADMAP.md` e `NEXT-STEPS.md`.

## QA visual

`docs/qa/` contém screenshots renderizados com dados representativos locais, sem dados reais de produção.
