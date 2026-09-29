# Power BI: configuração, coleta e mapeamento

Página `bi.html`, acessível por Conexões e pela busca do Console. Esta conexão RD é independente da importação operacional de clientes. Não reaproveita nem remove as credenciais existentes.

## Ativação

1. Instalar `supabase/migrations/20260929204824_bi_console_oauth.sql` no Supabase técnico do Console. O App precisa de sua migration BI e backend coletor publicado antes de receber lotes.
2. Em Conexões → Power BI, cadastrar `BI_RD_CLIENT_ID`, `BI_RD_CLIENT_SECRET` de aplicativo **RD Station CRM v2** e `BI_CONSOLE_BASE_URL` (URL HTTPS canônica do Console, sem caminho). Tokens de Marketing ou API v1 não são intercambiáveis com OAuth CRM v2.
3. Cadastrar no aplicativo RD o callback `<BI_CONSOLE_BASE_URL>/api/bi/oauth/callback`. Abrir `bi.html` no domínio canônico e autorizar com a conta RD correta. O login/consentimento é feito pelo usuário no RD; nunca pedir token/senha em chat.
4. Iniciar Catálogo. Processar páginas pelo botão ou pelo n8n até concluir todas as entidades, inclusive etapas de cada funil.
5. Carregar campos, selecionar funil e definir cada origem. Salvar a versão. Seleções não preenchidas não viram atribuições presumidas. Vendedora, vendedora da reunião e SDR exigem campos personalizados, sem escolha automática do dono do negócio.
6. Iniciar Comercial. Sem data, lê registros disponíveis; com data UTC, filtra `updated_at`. Cada carga usa a versão de mapeamento vigente no início; mudanças posteriores exigem outra carga.
7. Conferir registros recebidos, quarentenas e quantidades contra a conta RD. O Admin mostrará recepção, mas indicadores seguem indisponíveis até validação comercial e implementação das medidas.

Novo consentimento cria outra identidade de dataset, preservando a anterior sem mesclagem automática. Catálogo não fornece permissão para editar o CRM: o coletor só usa GETs comerciais. A troca/renovação OAuth é POST no endpoint de autenticação oficial.

## Segurança

- owner/developer: chaves, consentimento, mapeamento.
- operator: iniciar, processar e retomar cargas; sem acesso aos valores secretos.
- viewer: estado, catálogos e falhas, somente leitura.
- n8n: somente uma página da carga existente com `BI_AUTOMATION_TOKEN` de pelo menos 32 caracteres.
- Sessão/perfil validados no servidor; bloqueio de origem nos POSTs humanos. Estado OAuth de uso único vinculado à sessão e usuário, expira em 10 minutos. Tokens cifrados com AES-256-GCM, ligados à identidade da conexão. Refresh serializado e troca do par access/refresh atômica com versão.
- Chave de cifra depende de `DEV_SESSION_SECRET`; rotação desse segredo exige reautorizar o RD (não tentar usar silenciosamente ciphertext antigo).
- Banco técnico guarda apenas configuração, tokens cifrados e estados OAuth. Dados comerciais ficam em `bi_*` no banco principal, protegidos por RLS e backend M2M.

## Contrato para n8n

Cadastrar `BI_AUTOMATION_TOKEN` no Console e como credencial Header Auth no n8n; não colocá-lo na URL, no código ou em exportação de workflow. O valor de `BI_N8N_BASE_URL` é configuração, não ativa agendamento sozinho.

```http
POST /api/bi?action=step
Authorization: Bearer <credencial dedicada>
Content-Type: application/json

{}
```

Sem `run_id`, processa a carga em andamento da conexão atual. Resposta `idle: true` significa nenhuma carga em andamento. Em sucesso, `result.collected: true` significa apenas fim da leitura; `validated: false` impede confundir recepção e homologação. Repetir chamadas sequencialmente, com pelo menos 2 s entre páginas; respeitar `Retry-After`. Em 409 de lease, aguardar outra tentativa. Após falhas consecutivas, a carga pausa e exige Retomar no Console.

O token não inicia novas cargas nem altera mapeamento/chaves. Esta entrega não instala workflow numa instância n8n nem promete atualização contínua. O próximo passo do agendamento deve definir janela com sobreposição, periodicidade, reconciliação e políticas de pausa; nunca inferir que uma única carga é um espelho completo e permanente do CRM.

## Garantias e erros

Lotes de até 100 registros, checkpoint persistido junto com os dados, chave única por conexão/entidade/ID, lease de processamento e erro de página visível. Resposta incompleta/malformada, ID duplicado na página ou payload grande interrompem a página para correção. Registros externos atrasados/conflitantes vão para quarentena, mantendo a versão atual. Teto de 10 mil do RD tratado por divisão de janelas; densidade irresolúvel gera erro explícito.

Observações e totais de recepção não são leads/vendas validados. Releitura pode aumentar recebimentos sem aumentar IDs únicos. Contato não possui fonte/responsável nativos na API v2 documentada; os vínculos de origem vêm de negociações/campos explicitamente mapeados. Valores usam os campos reais `total_price`, `one_time_price` e `recurrence_price`, sem somar medidas financeiras antes da regra comercial.

## Testes e publicação

`npm run check` cobre sintaxe, refs HTML, limite de 12 Functions, segredos, RBAC, máquina limitada ao step, falha 429 sem avanço, projeção dos campos, paginação e cifragem. Banco isolado:

```sh
PGLITE_MODULE=/tmp/bi-db-qa/node_modules/@electric-sql/pglite/dist/index.js node qa/bi-oauth-db.mjs
```

Instalação temporária usada: `@electric-sql/pglite@0.5.8`. Testa locks/CAS do refresh, uso único de estado e bloqueio anon/authenticated. Nada usa credenciais reais nos testes. A validação OAuth com a conta RD real depende do cadastro de chaves e consentimento.

Rollback: parar o chamador n8n, reverter a versão do Console, manter tabelas cifradas e RLS. Não alterar as conexões operacionais anteriores. Não apagar histórico BI nem tokens sem decisão específica.

Conta Azul permanece como configuração reservada para a próxima fase. Nenhuma parcela é conciliada ou alterada por este módulo.

Instalação verificada em 29/09/2026: migration `20260929204824_bi_console_oauth` no banco técnico; as 2 tabelas têm RLS, sem SELECT para anon/authenticated. Zero conexões autorizadas. Arquivo alinhado à versão registrada pelo conector Supabase.
