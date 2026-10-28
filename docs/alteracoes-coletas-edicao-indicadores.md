# Entregas, coletas e indicadores por operação

**Atualizado:** 27/10/2026
**Deploy de staging planejado:** 28/10/2026
**Escopo:** Portal e API reais em staging. Produção será planejada depois do aceite do piloto.

## Regra do lançamento

- A coleta é preenchida dentro do mesmo registro da entrega. Data, localidade, motorista e ajudantes são informados uma única vez e valem para as duas operações.
- No registro, a pessoa informa separadamente quantidades realizadas e não realizadas de entregas e de coletas. A coleta não cria outro lançamento, outra data nem outra equipe.
- Cada entrega não realizada e cada coleta não realizada recebe seu próprio motivo e sua própria observação. O motivo também identifica se pertence à operação `ENTREGA` ou `COLETA`, para separar os indicadores.
- A classificação da equipe (`PROPRIA` ou `TERCEIRIZADA`) continua vindo do cadastro das pessoas participantes. Os filtros e indicadores aplicam a mesma classificação às entregas e coletas daquele registro.
- O OTIF combinado considera as quantidades não realizadas de entregas e coletas sobre o total registrado das duas operações. Os painéis também mostram os totais separados por operação e por grupo de motivo.
- O fluxo de lançamento salva diretamente, sem etapa de conferência. O histórico permite consultar, editar ou cancelar; editar não pede justificativa e as ações continuam auditadas.

## Alterações de API e banco

- `op_logistica_entrega_diaria` continua sendo o registro único por data, localidade e equipe. Recebe as colunas `quantidade_coleta_realizada` e `quantidade_coleta_nao_realizada`; as quantidades de entrega permanecem nas colunas existentes.
- `op_logistica_entrega_motivo.tipo_operacao` identifica a qual conjunto de quantidades pertence cada motivo (`ENTREGA` ou `COLETA`). Uma observação fica vinculada a cada ocorrência.
- `op_logistica_entrega_diaria.tipo_operacao` é mantido temporariamente para compatibilidade com o contrato anterior. Novos registros combinados usam `ENTREGA`; a operação de cada motivo e os campos próprios de coleta identificam os dados de coleta.
- A API aceita temporariamente o payload antigo de coleta isolada e o converte para os campos de coleta do registro compartilhado. A interface atualizada envia um único registro combinado.
- A migration `a640c9e2f7b1` já está aplicada em staging e fornece a chave de ocorrência dos motivos. A migration nova `b17d4e82c906`, filha de `a640c9e2f7b1`, acrescenta as quantidades de coleta ao item e a operação no motivo, preservando o vínculo de cada ocorrência.
- A migration `b17d4e82c906` também normaliza linhas históricas criadas pelo rascunho anterior. A classificação de motivos legados é preservada; a migration não altera os participantes, data ou localidade associados a cada linha.

## Interface, histórico e importação

- O formulário mostra os campos comuns uma vez e, dentro do registro, apresenta blocos de entrega e coleta.
- O histórico e os detalhes exibem as quatro quantidades e identificam se cada motivo/observação pertence à entrega ou à coleta.
- O CSV novo usa uma linha por registro compartilhado, com colunas próprias para quantidades, motivos e observações de entrega e coleta. Arquivos antigos com `tipo_operacao` continuam aceitos e são convertidos para o formato combinado.
- Cada unidade não realizada precisa de exatamente uma ocorrência de motivo, inclusive quando várias unidades usam o mesmo motivo; as observações não são compartilhadas.

## Indicadores

- O painel mantém os totais de entrega e coleta distintos, além dos totais e do OTIF combinados.
- Os gráficos de motivos e grupos separam `ENTREGA` e `COLETA`, exibem quantidade e percentual no denominador correspondente e respeitam filtros de período, localidade e transporte.
- O filtro de transporte próprio/terceirizado considera a equipe compartilhada do registro para as duas operações.
- A página de ranking por pessoa mantém os filtros de pessoa, função, situação cadastral, período, localidade e transporte. Os motivos ajudam a explicar os resultados, sem criar penalidade automática não aprovada.

## Deploy planejado para amanhã — 28/10/2026

O objetivo é publicar e validar a correção em staging amanhã. Não executar a migration nem o workflow da API antes do código corrigido estar revisado e com CI aprovado.

1. **Concluir e revisar hoje (27/10):** formulário único, contrato/API, persistência, histórico, importação, indicadores, testes e este documento. Confirmar que data, localidade e equipe aparecem uma vez e são salvas no mesmo item das duas operações.
2. **Publicar o código corrigido:** enviar o commit para a branch `staging` do Portal e confirmar CI verde e Preview concluída. Publicar a migration `b17d4e82c906` na branch `logistica` do VilarejoBI.
3. **Amanhã, antes do deploy da API:** confirmar o snapshot de staging, aplicar `alembic --name logistica upgrade head` no banco operacional e verificar `alembic --name logistica current` em `b17d4e82c906 (head)`. Se a migration falhar, parar e investigar antes de atualizar a API.
4. **Amanhã, com schema e CI aprovados:** executar o workflow manual **Deploy Portal API to Staging**. A API nova depende das colunas da migration e não deve ser implantada antes dela.
5. **Validar em staging:** criar um registro com entrega e coleta usando a mesma data/localidade/equipe; confirmar os quatro totais, motivos e observações separados por operação, histórico/edição, filtro próprio/terceirizado e totais/OTIF do painel. Conferir também um registro só com entrega e outro só com coleta dentro do mesmo modelo de formulário.
6. **Registrar o aceite ou os bloqueios:** guardar os links do CI e do deploy, revisão Alembic aplicada, resultado do smoke test e pendências. Não promover para produção nesta etapa.

O snapshot já foi confirmado pelo operador antes da migration anterior. Reconfirmar sua disponibilidade antes do próximo upgrade; o snapshot não substitui a validação de `current` nem o smoke test posterior.

## Estado atual

- O staging está na revisão `a640c9e2f7b1 (head)`; `b17d4e82c906` ainda precisa ser publicada e aplicada.
- O código desta correção está em trabalho local. O commit `3463c7b` e seu CI antecedem a mudança para formulário combinado; é necessário gerar novo commit e novo CI.
- O workflow manual da API ainda não deve ser executado. A ordem planejada é: código corrigido e CI verde, migration aplicada, workflow da API, smoke test.
- Produção e a integração automática com o ERP SEAC permanecem etapas posteriores. A integração SEAC precisa automatizar a origem dos dados do lançamento antes do lançamento oficial.
