# Funções do Dev Console V1

## Autenticação própria

- Login por e-mail/senha no Supabase separado.
- Sessão assinada no backend e armazenada em cookie HttpOnly.
- Recuperação e redefinição de senha.
- Sessão de 8 horas.
- Rate limiting básico persistido por eventos de autenticação.
- Auditoria de login/logout.

## RBAC próprio

Perfis: Owner, Developer, Operator e Viewer.

A tela `dev-acessos.html` permite ao Owner:

- criar novo acesso técnico;
- definir role;
- ativar/desativar;
- conceder permissões extras;
- consultar último acesso;
- consultar auditoria do control plane.

## Proxy server-to-server

`DC.api()` roteia automaticamente APIs do Sra Luck para `/api/sra-proxy`.

O proxy:

- valida a sessão Dev;
- valida permissão por domínio;
- injeta identidade do operador;
- usa token M2M somente server-side;
- mantém request ID;
- audita mutações.

## Conexões

`conexoes.html` mostra:

- Supabase técnico;
- segredo de sessão configurado/não configurado;
- health/ready do Sra Luck;
- token M2M configurado/não configurado;
- GitHub token configurado/não configurado;
- teste público e administrativo do conector.

## Observabilidade existente

As páginas operacionais continuam preparadas para:

- Visão Geral;
- Incidentes;
- Monitoramento;
- V46;
- Financeiro;
- App/PWA;
- Notificações/Web Push;
- Clube;
- Integrações;
- Equipe/RBAC do sistema principal;
- Código/Releases.

## Central de Problemas

`problemas.html` junta em uma lista única o que está falhando no Admin, no App da cliente, nas notificações, na V46, no financeiro e nas integrações, com a correção ao lado:

- **correção segura (L2)**: executa na hora e roda sozinha na varredura diária;
- **correção com confirmação (L3)**: altera dados de clientes; pede clique e confirmação;
- **pacote técnico / issue**: bugs de código saem com rota, código, request IDs e amostras sem dados pessoais;
- **link**: quando a decisão é humana (V46, validação financeira), leva para a tela certa.

Depois de cada correção, o console reconsulta as fontes e informa se o problema foi resolvido de fato.

Desempenho do App (memória, travamentos e carregamento lento) chega pelo monitoramento de erros do Sra Luck com os códigos `APP_MEMORY_PRESSURE`, `APP_MAIN_THREAD_BLOCKED` e `APP_SLOW_LOAD`.

## Controle do Admin Sra Luck

Com `DEV_CONSOLE_M2M_WRITE=1` no Sra Luck, o Dev Console opera as mesmas funções do Admin, sem regra nova:

- **Notificações** (`notificacoes.html`): ligar/desligar o lembrete de atraso, frequência, máximo de tentativas, criar/editar/ativar templates, envio manual para uma cliente e envio forçado de atrasos.
- **Configurações do Admin** (`configuracoes-sra.html`): nome da clínica, meta mensal, frase do app, bloqueio da agenda de liberação financeira, PIX (chave, desconto, QR Code), contatos e cores do tema. Só os campos alterados são enviados.
- **Integrações** (`integracoes.html`): testes de conexão e teste/sincronização do RD Station. Credenciais e chaves VAPID continuam sendo editadas no Admin.

## Histórico de acessos

Depende do PR de monitoramento de acessos no `sra-luck-react` (tabela `monitoramento_acessos`).

- **Clientes & App → drawer da cliente**: uso nos últimos 7 dias, telas mais vistas, aparelhos (celular/computador, sistema, navegador), app instalado ou só navegador, push, linha do tempo de cada aba aberta e erros que aconteceram no app dela.
- **Atividade do Admin** (`admin-atividade.html`): por colaborador, telas abertas, último acesso, erros e alterações; feed recente e telas mais usadas, com período de 24h, 7 ou 30 dias.

## Próxima evolução

Consultar `AGENTS-ROADMAP.md`.

## Infraestrutura & Recursos

`infraestrutura.html` é o cockpit do Infrastructure & Resource Guardian.

Funções:
- status de cada provider;
- RAM/swap/disco/CPU/I/O do Supabase;
- logs de erro do Supabase;
- memória e CPU do Cloudflare Worker;
- deploys Vercel;
- memória da Function atual do Dev Console;
- telemetria App/PWA;
- sinais com thresholds visíveis;
- execução manual do Guardian;
- incidentes de infraestrutura persistidos.

A interface diferencia `não configurado` de `indisponível` e nunca substitui uma métrica ausente por valor fictício.
