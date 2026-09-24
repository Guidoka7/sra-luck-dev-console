# Changelog

## 0.8.0 — Investigação guiada

- checklist de diagnóstico por tipo de falha (5xx, 401/403, 404, timeout, banco, storage, recurso de infraestrutura, deploy com falha, produção desatualizada, CI, erro de tela, pendência operacional, regressão), em ordem, com cada passo marcado como verificado, confirmado, pista, "verificar você" ou sem dados;
- reteste de um teste específico (checklist, drawer de fluxo e drawer de componente) sem rodar a varredura inteira; só leitura no Sra Luck, gravado no histórico como reteste manual;
- antes x depois de cada deploy de produção e migration: mediana de tempo e falhas de cada teste e erros por hora do App, Admin e API, com janela de até 24 h limitada pelas mudanças vizinhas e aviso quando faltam leituras;
- regressões das últimas 72 h marcadas em "Últimas alterações" e abertas como alerta quando nenhuma falha atual já as cobre;
- linha do tempo única do incidente: deploys, migrations, início, falhas e recuperações do teste, repetições, reabertura, correções registradas e retestes;
- recorrência em 7 dias (episódios de falha e reaberturas);
- "Copiar relatório técnico" em Markdown: componente, tipo de falha, versões, impacto, causa e base, evidências, checklist, antes x depois, linha do tempo e próximos passos, sem dados pessoais de clientes;
- incidentes de infraestrutura que voltam depois de mitigados agora são reabertos e registram o evento `reopened` (antes ficavam como mitigados e sumiam da visão);
- nenhuma ação desta etapa corrige produção.

## 0.7.0 — Diagnóstico na Visão Geral

- cada alerta traz causa provável (marcada como "baseada em evidência", "hipótese" ou "sem causa identificada"), impacto e próxima ação;
- a causa usa só dados reais: código HTTP do teste, componente de que ele depende estar com falha, deploy de produção ou migration entre 6 h antes e 15 min depois do início, e o estado do deploy do commit da main;
- "Próxima ação" no topo, com o alerta mais grave; alertas de nível atenção ficam recolhidos em "Em observação";
- drawer "Investigar" por alerta: causa e em que se baseia, passos em ordem, evidências, linha do tempo com as mudanças suspeitas e "Copiar resumo";
- drawer de componente com histórico de 24 h, dependências (App e Admin → API → Supabase/Storage, publicados pela Vercel), evidências sem repetição, mudanças das últimas 72 h e alertas do componente;
- componentes ordenados por gravidade e marcados como "efeito provável" quando a falha vem de uma dependência;
- `/api/problemas` informa desde quando cada problema existe (incidente aberto);
- `github-status?resource=changes` devolve os 12 deploys lidos (antes 8) para a correlação.

## 0.6.0 — Visão Geral operacional

- Visão Geral refeita sobre as fontes existentes (sem tela nova): estado geral em uma linha, saúde de App, Admin, API/Worker, Supabase, Storage, Vercel e Cloudflare com drawer por componente (o que está acontecendo, medições, problemas relacionados, link para a página certa);
- incidentes e alertas com contexto, impacto e ação recomendada (Central de Problemas, incidentes de infraestrutura, CI da main, deploy de produção com erro, produção atrás da main);
- histórico real em gráficos: latência dos fluxos, erros do App/Admin/API por período e recursos do banco e do Worker, com aviso honesto quando há poucas leituras;
- fluxos críticos testados de verdade, com drawer das etapas;
- últimas alterações: deploys, commits, CI e migrations, e se a produção roda o mesmo código da main;
- latência de cada fluxo passa a ser gravada no histórico (`source=probe`) em toda varredura;
- `GET /api/github-status?resource=changes`;
- varredura horária gratuita opcional via GitHub Actions (`.github/workflows/guardian-scan.yml`, secrets `DEV_CONSOLE_URL` e `CRON_SECRET`);
- gráficos: escala do eixo Y em passos redondos, margem que não corta rótulos e contagens sem casas decimais;
- Visão Geral mais enxuta: "Serviços essenciais" e "Funções espelhadas do Admin" viraram "Saúde por componente"; "Atenção necessária" virou "Incidentes e alertas"; "Domínios de manutenção" e "Atividade recente" (listas sem ação direta) saíram — seguem em Central de Problemas, Agentes e Auditoria.

## 0.5.0 — Central Inteligente de Notificações (etapa 1)

- Notificações: drawer da Central com as abas Operação, Chat Gemini, Regras financeiras, Agenda/jornada/eventos, Relatórios, Configurações e Auditoria, sobre `/api/admin/notificacoes/lotes*` do Sra Luck (Guidoka7/sra-luck-react#59);
- uma mensagem por cliente (parcelas agrupadas), régua por faixa, dry run, prévia por amostragem, "por que ficou de fora" por cliente, aprovação com confirmação, fila em horário silencioso, reprocessar só falhas;
- o chat do Gemini responde só com os dados do lote e apenas **sugere** ações; quem executa é você, pelo botão;
- sem backend novo publicado, a Central mostra "indisponível" com o motivo real (versão antiga, migration 088 ou conector), sem dados simulados;
- varredura automática não dispara mais rotinas de cobrança (exigem confirmação humana);
- mensagens de erro do conector cobrem os códigos da allowlist M2M atual.

## 0.4.0 — Central de Problemas

- navegação por áreas (Admin Sra Luck com submenu), páginas duplicadas removidas, Engenharia no lugar de Código & Releases;
- saúde de cada função espelhada do Admin na Visão Geral e na Central;
- histórico de acessos da cliente no drawer e página Atividade do Admin;
- Agentes: sete assistentes que explicam cada problema em linguagem simples, trazem boas notícias, corrigem o que é seguro e (opcional) pedem análise ao Gemini gratuito;
- ícones completos no console;
- Carrossel do App: cartões da Início configuráveis pelo console, com prévia;
- Clube: editar, pausar e excluir recompensas;
- Engenharia: PRs, CI, commits e deploys dos dois projetos com re-rodar CI, merge, criar PR, disparar workflow, redeploy, promover e rollback;
- Memória e recursos com gráficos interativos (crosshair, tooltip de todas as séries, faixas 1h a 30 dias, tabela acessível) para os dois bancos, o Worker e a função do console;
- Integrações reformuladas com logos oficiais, filtros por grupo, detalhes por provedor, histórico e APIs personalizadas monitoradas;

- controle do Admin pelo Dev Console: configuração da automação de notificações, templates, envio manual e configurações gerais do Admin (`configuracoes-sra.html`);

- Central de Problemas (`problemas.html`, `/api/problemas`) cobrindo plataforma, Admin, App da cliente, notificações, V46, financeiro e integrações;
- correções pelo backend com registro fechado de ações, RBAC por ação, auditoria e verificação pós-correção;
- correções seguras automáticas na varredura agendada e incidentes `source=problems`;
- desempenho do App (memória, travamentos, carregamento) como problemas acompanháveis;
- mensagens claras quando o Sra Luck recusa correções (somente leitura, rota fora da lista, papel);
- validador atualizado para rotas consolidadas e limite de Functions da Vercel.

## 0.3.0 — Repo-ready

- navegação operacional simplificada;
- login próprio, sessão HttpOnly e RBAC;
- usuários técnicos do Dev Console;
- proxy server-to-server para o Sra Luck;
- incidentes e runbooks;
- Infraestrutura & Resource Guardian;
- observabilidade dos dois Supabases;
- Cloudflare Worker analytics;
- Vercel deploy/runtime;
- histórico de métricas e thresholds sustentados;
- CI de validação;
- verificação básica de segredos;
- documentação de arquitetura, segurança, deploy, operação e QA visual.

## 0.2.0

- primeira base V1 separada do `sra-luck-react`;
- autenticação e conector M2M planejado;
- telas operacionais iniciais.
