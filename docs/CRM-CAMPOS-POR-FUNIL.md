# Campos escolhidos por funil

No Dev Console: Integrações → RD Station → função de importação → selecionar um funil → Configurar → Campos escolhidos para este funil.

O usuário adiciona campos personalizados da negociação ou do contato e os campos nativos oferecidos pelo backend. Cada seleção tem uma origem estável (`entidade:slug`) e um nome editável. É possível remover campos. Cada funil tem até 100 campos próprios; nenhum é escolhido automaticamente. Os destinos fixos do cadastro continuam na seção Preenchimento dos dados.

Salvar usa a rota existente de configuração, sua autorização, versão e auditoria. Nenhuma credencial nova é necessária. A capacidade `camposLivres` do catálogo protege a compatibilidade com o backend anterior. Sem ela, o novo editor não envia propriedades incompatíveis.

## Dados

`funis[].camposSelecionados = [{ fonte, rotulo }]` fica no JSON de configuração existente. As próximas importações guardam valores e situação (`presente`, `ausente`, `origem_nao_carregada`) em `novas_vendas.rd_snapshot._sra_mapeamento`, além dos dados de itens novos do histórico. Zero, falso e listas são preservados. Um webhook sem contato carregado sinaliza essa origem como não carregada; não é prova de ausência no RD. Esta alteração não implementa indicadores, tradução de categorias, vínculo de equipe, obrigatoriedade comercial ou coleta histórica completa.

Campos apagados do catálogo continuam visíveis no editor com aviso, até o usuário removê-los. Seleções em branco são permitidas. Não criar colunas de banco a partir dos nomes escolhidos.

## Publicação

Branch de App e Console: `codex/crm-campos-por-funil`, derivada da branch atual de trabalho do Claude. Revisar os dois diffs antes de integrar. Não substitui nem sobrescreve a branch dele.

É necessário backend com `camposLivres` e este Console para usar o editor. Um Preview do Console apontado ao App antigo só mostrará o aviso de atualização; não alterar sua origem para banco real para testar. Os testes usam dados fictícios e banco em memória. A branch do App inclui trabalho anterior que depende da migration 112 antes de promoção. Não aplicar migrations nem promover em decorrência desta documentação.

Validação: testes DOM para seleção, remoção, isolamento, reabertura, fonte indisponível e escape; testes no App para validação, persistência, extração e reimportação preservando dados locais. Rollback do Console volta ao editor anterior. Não salvar configuração antiga após rollback sem preservar `camposSelecionados`, pois clientes antigos não conhecem esse campo.
