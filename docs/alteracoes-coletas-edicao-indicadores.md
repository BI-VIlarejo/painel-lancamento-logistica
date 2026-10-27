# Entregas, coletas e indicadores por operação

**Registro:** 27/10/2026
**Escopo:** Portal real e API operacional de staging. Produção não faz parte desta alteração.

## Requisitos do setor

- Depois da seção de entregas, o lançamento oferece uma seção separada para coletas.
- Cada seção registra quantidades realizadas e não realizadas, equipe, data e localidade.
- Cada unidade não realizada tem uma ocorrência própria de motivo e uma observação opcional. Duas unidades podem usar o mesmo motivo, mas continuam tendo observações independentes.
- Coletas entram no total e no cálculo de OTIF. Os painéis também deixam os totais de entregas e coletas identificáveis.
- O lançamento é enviado diretamente depois do preenchimento, sem uma etapa final de conferência. O histórico segue como local para consultar, editar, corrigir ou cancelar.
- A edição de um lançamento confirmado abre a edição diretamente, sem solicitar justificativa. O evento continua auditado; cancelar um lançamento continua exigindo justificativa e retirando-o dos indicadores.
- O painel gerencial recebe filtro de Entregas próprias / Entregas terceirizadas. O ranking por pessoa passa para `/indicadores/pessoas`, com filtros do período, localidade, tipo de transporte, nome, função e situação cadastral.

## Persistência e API

- `op_logistica_entrega_diaria.tipo_operacao` identifica cada linha como `ENTREGA` ou `COLETA`. Linhas históricas recebem `ENTREGA` como valor padrão durante a migration.
- `op_logistica_entrega_motivo` passa a ter uma chave substituta `id_entrega_motivo`, permitindo repetir o mesmo motivo na mesma linha de entrega/coleta. Cada associação nova grava `quantidade = 1` e a observação daquela ocorrência.
- A API exige que o número de associações de motivo seja igual à quantidade não realizada. Ao ler registros antigos que agrupavam uma quantidade por motivo, a resposta expande cada unidade em uma ocorrência individual.
- O endpoint do painel aceita `tipo_transporte_entrega=PROPRIA|TERCEIRIZADA`. Os totais gerais e de cada operação usam o mesmo filtro.
- Razões e grupos de motivo são agregados por operação. Seus percentuais usam o denominador das não realizadas e o total planejado daquela mesma operação.
- O OTIF continua usando o cálculo operacional acordado no projeto: itens não realizados divididos pelo total registrado. Neste recorte, o numerador e o denominador incluem entregas e coletas; os totais de cada operação também são devolvidos separadamente.

## Interface e arquivos de importação

- O formulário normal envia e confirma o lançamento em uma ação. Se a confirmação falhar depois de salvar, o rascunho permanece disponível para tentativa posterior no histórico.
- A edição de rascunho ou de revisão de correção usa o mesmo formulário. Corrigir não exige um prompt de justificativa; o evento de início da correção permanece registrado na auditoria.
- O importador CSV aceita a coluna `tipo_operacao` com `ENTREGA` ou `COLETA`; sua ausência mantém compatibilidade com arquivos antigos e assume `ENTREGA`.
- Motivos CSV no formato `CODIGO:QUANTIDADE` são expandidos em ocorrências individuais. Quando houver observações, deve haver uma entrada por ocorrência, na mesma ordem, separada por `|`.
- Cancelamento permanece a forma auditável de retirar um lançamento confirmado dos indicadores. O histórico não apaga fisicamente lançamentos confirmados.

## Ordem de entrega em staging

1. Revisar e publicar juntos o código do Portal e a migration na cadeia Alembic `logistica` do VilarejoBI.
2. A CI deve passar antes da publicação da API e do frontend de staging.
3. Aplicar a migration `a640c9e2f7b1` em staging, que depende de `e31f9a7c2b64`, e conferir `alembic --name logistica current`.
4. Publicar API e frontend no staging real, sem apontar preview para produção.
5. Validar criação, edição, consulta histórica, cancelamento auditado, filtros de transporte e agregações de entregas/coletas com usuários e cadastros do piloto.
6. Após o aceite operacional, planejar separadamente migration e publicação em produção.

**Estado registrado neste documento:** o Portal foi publicado na branch `staging` no commit `2af9da7` e o CI passou; a prévia Vercel reportou deployment concluído. A migration foi publicada na branch `logistica` do VilarejoBI no commit `c11e36e`. O banco de staging segue em `e31f9a7c2b64`; ainda falta snapshot RDS e aplicação de `a640c9e2f7b1`, seguida do deploy manual da API e do aceite funcional. Produção permanece fora desta etapa. A integração automática com o ERP SEAC continua prevista antes do lançamento oficial.
