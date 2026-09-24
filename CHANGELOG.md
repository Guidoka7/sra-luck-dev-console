# Changelog

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
