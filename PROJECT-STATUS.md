# Estado do projeto

## Pronto no código

- frontend HTML completo e simplificado para operação;
- login, logout, sessão HttpOnly e recuperação de senha;
- RBAC Owner / Developer / Operator / Viewer;
- gestão de usuários técnicos;
- proxy server-to-server para o Sra Luck;
- health/readiness do próprio Dev Console;
- leitura GitHub server-side;
- central de incidentes e runbooks;
- monitoramento/diagnóstico do Sra Luck via proxy;
- módulo de Infraestrutura & Recursos;
- Supabase principal + Supabase Dev Console;
- Cloudflare Worker analytics;
- Vercel deploy/runtime;
- histórico de métricas;
- Infrastructure & Resource Guardian;
- migrations próprias;
- CI de validação do repo;
- QA visual de referência.

## Depende de configuração externa

- criação do novo repositório GitHub;
- criação do projeto Supabase Dev Console;
- criação do projeto Vercel Dev Console;
- aplicação das migrations;
- cadastro do primeiro Owner;
- variáveis privadas da Vercel;
- tokens Management API Supabase;
- token Cloudflare Analytics;
- token Vercel;
- token GitHub opcional;
- scheduler real do Guardian.

## Depende de mudança no `sra-luck-react`

- autenticação M2M dedicada para o Dev Console;
- endpoints/telemetria adicionais dos futuros agentes;
- heartbeat estruturado dos jobs do sistema principal;
- V46 Journey Guardian;
- Financial Integrity Agent;
- Notification Delivery Agent avançado;
- Job & Queue Supervisor completo;
- traces ponta a ponta por request ID.

## Regra

Quando uma fonte não estiver configurada, a UI deve mostrar **Configuração incompleta/indisponível**. Nunca preencher números fictícios em runtime.
