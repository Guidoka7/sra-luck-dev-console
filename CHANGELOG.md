# Changelog

## 0.11.0 — CRM e Conta Azul nas Integrações

- formulário de cada função gerado pela descrição de campos do catálogo do Sra Luck (seleção, múltipla escolha, mapeamento, grupo de opções), com listas lidas do provedor na hora (funis, etapas e campos do RD; contas financeiras e categorias da Conta Azul);
- RD Station: configurar funil, etapas, status, campos importados e mapeamento, deduplicação por CPF/telefone/e-mail e importação automática; aba Importações com histórico, itens de cada importação (dados mascarados), duplicidades aguardando revisão e "Importar agora";
- Conta Azul: aba Operação só leitura (conexão, vínculos, conflitos em revisão, fila e execuções); configuração exibida bloqueada, alterável só no Admin;
- "Sincronizar RD" passa a usar a importação configurável (`/rd-station/importar`).

## 0.10.0 — Padrão de integrações

- o drawer de cada integração passa a ser montado a partir do catálogo do Sra Luck (`GET /api/admin/integrations/catalogo`), com as abas Visão (credenciais mascaradas, status, teste de conexão), Funções, Dados e mapeamento, Sincronização, Webhooks, Histórico e Regras e limites; integração nova entra no registro do Sra Luck, sem mudar o Dev Console;
- cada função mostra a situação real: disponível, "API permite · não implementado" ou "API não permite", com o motivo (ex.: Conta Azul sem webhooks e sem cancelamento pela API);
- Gemini configurável por função (mensagem diária e notificações): liga/desliga, modelo, prompt/base, temperatura, máx. tokens e limite diário com o uso de hoje; só owner/developer editam, com versão e auditoria no Sra Luck;
- a conversa da mensagem diária continua no botão "Conversar sobre a mensagem diária";
- sem o catálogo em produção, aviso na página e drawer no formato anterior.

## 0.9.1 — Deploy Cloudflare

- `wrangler.jsonc`: publica só `dist/` (antes, sem configuração, o Wrangler usava a raiz e tentava enviar `node_modules`, falhando com "Asset too large");
- `scripts/build-static.mjs` monta `dist/` com as páginas e `assets/`, gera `_headers` a partir do `vercel.json` e `_redirects` para `/`; o Wrangler roda o build sozinho;
- `.assetsignore` como rede de segurança; `dist/` e `.wrangler/` no `.gitignore`; arquivos do Cloudflare fora do deploy da Vercel;
- nada muda na Vercel nem no funcionamento do console.

## 0.9.0 — Central de Incidentes

- nova página `incidentes.html` (menu: Central de Incidentes) sobre `dev_incidents`/`dev_incident_events`, sem tabela nova: histórico, status, recorrência, responsável e notas;
- marcar investigando, mitigado ou resolvido (resolvido pede confirmação), atribuir ou assumir, adicionar nota, aplicar ao grupo inteiro; tudo com evento e auditoria, sem mexer na produção;
- alertas relacionados agrupados (mesmo deploy suspeito, mesmo componente ou componentes dependentes, com o motivo explícito);
- "Voltou": reaberturas contadas e destacadas; resolvido que volta reabre sozinho, e "mitigado, mas ainda detectado" aparece como exigindo ação;
- relação de cada incidente com componente, fluxo, testes e deploys/migrations perto do início, com antes x depois;
- estabilidade 24 h e 7 dias por componente a partir das leituras gravadas dos testes (não é uptime), com faixa dia a dia;
- só "Exigem ação" fica aberto; acompanhamento e resolvidos ficam recolhidos;
- varredura respeita a marcação manual: mitigado marcado por alguém não é reaberto só por continuar detectado, a marcação não é apagada pela regravação do metadata, e `resolved_at` é limpo ao reabrir;
- mapa do sistema (componentes, fluxos, dependências, testes) e mudanças passam a ter uma definição só em `dev-console-investigacao.js`, usada pela Visão Geral e pela Central;
- Visão Geral: "Acompanhar incidentes" e "Acompanhar" no drawer do alerta; `visao-geral.html?investigar=<chave>` abre a investigação guiada.

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
