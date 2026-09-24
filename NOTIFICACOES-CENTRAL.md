# Central Inteligente de Notificações: auditoria e plano

Auditoria feita sobre `Guidoka7/sra-luck-react@main` (`20bec0f`) e este repositório (`f8f0928`).

## 1. O que já existe

| Peça | Onde | Situação real |
|---|---|---|
| Rotina de vencimento | `worker/admin-notificacoes.ts` → `executarVencimentos` | Percorre **cada parcela** que vence em até 2 dias e cria uma notificação por parcela. Deduplica por parcela + título, para sempre. |
| Rotina de atraso | `executarAtrasos` | Percorre **cada parcela** em atraso: uma notificação por parcela. Deduplica por parcela dentro de `frequencia_atraso_horas` (padrão 24 h). |
| Envio | `registrarNotificacao` → `notificacoes_cliente` + `notificacao_logs` + Realtime + `enviarWebPushParaCliente` | Grava `status: "enviada"` **antes** do push. O resultado do push fica em `push_status` (`enviada/parcial/falhou/sem_dispositivo/nao_configurado`). |
| Templates | `notificacao_templates` (tipo `parcela_vencer` / `parcela_atrasada` + `dias_referencia`) | Texto fixo com `{{cliente}}`, `{{valor}}` etc. Usa o **nome completo**. |
| Configuração | `notificacoes_config` (chave/valor) | Três chaves: `atraso_habilitado`, `frequencia_atraso_horas` e `max_tentativas` (esta última é gravada, mas nenhum código a usa). |
| Envio manual | `POST /api/admin/notificacoes/enviar` | Envia para uma cliente e grava auditoria em `logs_alteracoes`. |
| Scheduler | Nenhum no Sra Luck para notificações (`vercel.json` só agenda a frase do dia). | Quem dispara: `POST /api/internal/notificacoes/automacao` com `NOTIFICACOES_CRON_SECRET` (chamador externo) **ou** o cron diário do Dev Console via M2M. |
| Web Push | `worker/web-push-sender.ts`, `web-push-config.ts`, `client-push.ts`; SW em `public/simulador-iphone-sw.js` | O clique na notificação abre o app, mas **não registra abertura nem clique**. |
| Leitura no app | `worker/client-notificacoes.ts` (`lida`) | "Lida" = a cliente marcou dentro do app. Não é abertura do push. |
| Gemini | `worker/frase-do-dia.ts` (`gerarComGemini`, `validarFraseIa`, `configuracaoGemini`) | Reaproveitável: fila de modelos, timeout, erro de chave e JSON schema. |
| Auditoria | `logs_alteracoes` | Usada no envio manual. As rotinas automáticas não auditam. |
| M2M | `worker/dev-console-auth.ts` (commit 7c953a2 do dono) | Só 2 mutações: `notificacoes/automacao {acao: verificar_atrasos \| verificar_momentos_especiais}` e `integrations/testar-conexao {provedor: gemini \| mercado_pago}`, com payload validado campo a campo. |
| Eventos transacionais | — | **Não existem.** Pagamento, comprovante, agenda e jornada não geram notificação. Só o voucher do Clube insere direto em `notificacoes_cliente`, sem push. |

## 2. Problemas encontrados (reais, no código de hoje)

1. **Uma notificação por parcela.** Três parcelas em aberto = três notificações no mesmo dia.
2. **Cobra quem já enviou comprovante.** O filtro é `status != 'pago'`, então parcelas `pendente_confirmacao` (comprovante em conferência) também recebem cobrança.
3. **Data em UTC.** `new Date().toISOString().slice(0,10)` vira "amanhã" depois das 21h em Brasília, e a régua erra um dia.
4. **"Enviada" não significa entregue.** O log nasce `enviada` antes do Web Push. Não existe abertura nem clique real.
5. **Sem horário silencioso, sem aprovação e sem lote.** A rotina envia na hora em que é chamada.
6. **Dev Console disparava cobrança sozinho.** A varredura diária tratava `verificar_atrasos` como correção segura (L2). **Corrigido em `f8f0928`**: agora exige confirmação humana.

## 3. O que reaproveitar

- `registrarNotificacao`: continua sendo o **único** caminho de envio (notificação no app, Realtime e Web Push).
- `gerarComGemini` e `configuracaoGemini`: mesma chave, mesmo modelo, liga/desliga da integração (#58).
- `notificacoes_config`: novas chaves da central (horário, janela de deduplicação, horário silencioso, aprovação obrigatória).
- `notificacao_logs`: continua registrando cada envio. O lote aponta para o `notificacao_id`.
- `logs_alteracoes`: auditoria de preparar, aprovar, cancelar e editar.
- `POST /api/internal/notificacoes/automacao`: ganha ações novas (`preparar_lote_financeiro`, `processar_fila`), sem mudar as existentes.

## 4. Arquivos que realmente mudam

**sra-luck-react**
- novo `worker/notificacoes-lotes.ts`: candidatos, agrupamento, segmentos, deduplicação, horário silencioso, lote, Gemini por item, envio e reprocessamento;
- novo `worker/notificacoes-lotes.test.ts`;
- `worker/admin-notificacoes.ts`: roteia `/api/admin/notificacoes/lotes*` e ganha as ações internas novas. Com a central ativa, as rotinas por parcela passam a ser ignoradas (`SKIPPED_RULE`), para não haver envio duplo;
- `worker/dev-console-auth.ts`: entradas explícitas READ / PREPARE / APPROVE / SEND / CANCEL, com validação de payload no mesmo estilo do 7c953a2;
- `supabase/migration_085_notificacao_lotes.sql`.

**sra-luck-dev-console**
- `notificacoes.html`: drawer da Central com abas Operação, Chat Gemini, Regras, Agenda/Jornada, Relatórios, Configurações e Auditoria;
- `api/sra-proxy.js`: permissões das rotas de lote.

## 5. Migration necessária (085)

- `notificacao_lotes`:
  - `id`, `tipo`, `status`;
  - `criado_por`, `aprovado_por`, `aprovado_em`;
  - `prompt_version`, `modelo`, `config` (snapshot);
  - contadores;
  - `created_at`, `concluido_em`.
- `notificacao_lote_itens`:
  - `lote_id`, `cliente_id`, `segmento`, `parcelas` (jsonb: vencimento, valor, dias de atraso, id da parcela);
  - `valor_total`, `maior_atraso`;
  - `titulo`, `mensagem`, `gerada_por`, `gerada_em`, `editada_por`;
  - `status`, `motivo`, `notificacao_id`, `push_status`, `processado_em`.
- Status do lote:
  - `PREPARED`, `AI_GENERATION_FAILED`, `AWAITING_APPROVAL`, `QUEUED_FOR_ALLOWED_WINDOW`, `PROCESSING`, `COMPLETED`, `CANCELLED`.
- Status do item:
  - `PREPARED`, `AWAITING_APPROVAL`, `QUEUED`, `PROCESSING`, `PROVIDER_ACCEPTED`, `FAILED`, `SKIPPED_DEDUPLICATION`, `SKIPPED_RULE`, `OPENED`, `CLICKED`.
- **Sem cópia de clientes nem de parcelas.** O item guarda só o recorte usado na mensagem (auditoria do que foi dito), não uma fonte paralela.

## 6. Endpoints

| Método | Rota | Papel M2M |
|---|---|---|
| GET | `/api/admin/notificacoes/lotes`, `/lotes/:id` | READ |
| POST | `/api/admin/notificacoes/lotes/preparar` `{tipo:"financeiro"}` (dry run: nada é enviado) | PREPARE |
| POST | `/lotes/:id/gerar` `{instrucao?}` (Gemini por item, sem CPF, só o primeiro nome) | PREPARE |
| PATCH | `/lotes/:id/itens/:itemId` `{titulo, mensagem}` | PREPARE |
| POST | `/lotes/:id/chat` `{mensagem}` (Gemini responde sobre o lote, com dados agregados) | READ |
| POST | `/lotes/:id/aprovar` | APPROVE + SEND |
| POST | `/lotes/:id/reprocessar-falhas` | SEND |
| POST | `/lotes/:id/cancelar` | CANCEL |

## 7. Riscos de regressão e como ficam cobertos

- **Envio duplo** (rotina antiga + lote): a central nasce **desligada** (`central_lotes_ativa = false`). Enquanto estiver desligada, nada muda. Ligada, as rotinas por parcela retornam `SKIPPED_RULE`.
- **Gemini fora do ar:** o item fica `AI_GENERATION_FAILED`, sem texto genérico automático e sem envio.
- **Aprovação dupla ou concorrente:** transição de status condicional (`update … where status = 'AWAITING_APPROVAL'`).
- **Falha de uma cliente:** marca só aquele item como `FAILED`. O lote segue.
- **Reprocessar:** só itens `FAILED`. Nunca `PROVIDER_ACCEPTED`.
- **M2M:** nenhuma rota financeira (pagamento, parcela, vencimento, saldo ou jornada) entra na allowlist.

## 8. Fora desta etapa

- Eventos transacionais (pagamento, comprovante, agenda, jornada): exigem ganchos em cada fluxo. Ficam para a etapa seguinte.
- Abertura e clique reais: exigem o SW registrar `notificationclick` numa rota nova. Etapa seguinte.
- WhatsApp, SMS, e-mail, campanhas e qualquer IA decidindo valores: fora do escopo, como pedido.
