# Melhorias do Portal — 06/11/2026

Registro das solicitações da revisão com a Diretoria. A navegação, os detalhamentos dos gráficos, o ranking clicável, a paginação somente no rodapé e a exibição dos históricos sem rolagem vertical interna foram implementados localmente. A aba Meta e sua gravação também foram implementadas; sua persistência no ambiente depende da migration do banco. A separação visual ampla entre Entregas e Coletas foi experimentada e revertida após a revisão; os painéis gerais voltaram ao formato agregado.

## Navegação hierárquica

- [x] Substituir a barra lateral por uma navegação principal horizontal, inspirada no [padrão Disclosure Navigation do WAI-ARIA APG](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/).
- [x] Cada pasta de primeiro nível — por exemplo, **Suporte** ou **Transporte** — abre uma lista vertical de páginas e subpastas.
- [x] Uma subpasta mostra uma seta; ao acioná-la, abre ao lado o próximo nível, também vertical. Repetir para quantos níveis forem necessários.
- [x] Aplicar a estrutura a todas as pastas existentes, respeitando permissões e setores. A navegação não concede acesso que a conta não tenha.
- [x] Manter o menu acessível por teclado, com estado expandido/recolhido anunciado e fechamento por `Escape`.
- [ ] Rever detalhes visuais e comportamento em telas pequenas quando o diretor enviar os prints.

## Painel Gerencial

- [x] Criar uma aba **Meta** com resultado atual, comparação visual com a meta, edição e identificação da última alteração. A aba não herda os filtros gerais do painel.
- [x] Definir inicialmente a meta como taxa de realização (realizadas ÷ total registrado), com valor de **95%**. O diretor pode escolher a periodicidade (mensal, trimestral ou anual), o período de referência e se acompanha entregas, coletas ou ambas. A configuração vale para todo o portal; o período selecionado define apenas quais dados são comparados.
- [x] Permitir a edição a perfis globais de **DIRETORIA** e **DEV** e registrar mudanças em trilha append-only. A conta de Vyctor poderá editar se tiver um desses perfis/escopos.
- **Revertida após revisão:** a apresentação geral foi testada com gráficos e métricas separados por operação, mas Vyctor pediu para voltar ao formato anterior. Os resumos e gráficos gerais estão agregados novamente; a quebra por Entregas e Coletas continua nos detalhes de um item, como já havia sido solicitada.
- [x] Nos detalhes de evolução, loja, equipe, tipo de transporte, motivos e grupos, manter Entregas e Coletas em seções identificadas por operação.
- [x] Na **Performance por loja**, manter a escolha de ordem alfabética ou maior taxa agregada primeiro, com o nome como desempate.
- [x] Tornar os gráficos interativos: clicar em um ponto, barra, segmento ou linha abre detalhes do item selecionado, mantendo período e filtros.
- [x] Ao abrir ou fechar os detalhes, manter a página na mesma posição em que o usuário clicou no gráfico.
- [x] Nos detalhes de **Entregas próprias** e **Entregas terceirizadas**, mostrar motoristas responsáveis e quantidades realizadas/não realizadas das equipes; explicitar que os dados são coletivos por equipe.
- [x] No detalhe da loja, mostrar lançamentos, volumes realizados e não realizados, taxa, OTIF, elogios, reclamações, motivos e equipes associados.
- [x] Em **Não realizadas por motivos**, abrir o motivo para ver quantidade, percentuais e distribuição por equipe.
- [x] Exibir por motivo **% das não realizadas da operação** e **% do total da operação**, separando entregas e coletas.
- [x] Explicar os percentuais em linguagem direta: participação entre as não realizadas e participação no total de realizadas + não realizadas.
- [x] Nos detalhes por motivo, grupo, loja, equipe e tipo de transporte, relacionar os motivos às equipes e aos motoristas responsáveis, deixando claro que o lançamento é coletivo.
- [x] No ranking por pessoa, mostrar posição, pessoa, planejadas, realizadas, não realizadas, taxa, OTIF, score, elogios, reclamações e status como valores simples, sem gráficos, filtro por tipo de transporte ou motivos na linha principal. Clicar no nome abre o detalhamento por Entregas e Coletas e os motivos das equipes.
- [x] Alinhar os cabeçalhos do ranking aos valores de cada coluna: posição centralizada, pessoa à esquerda e campos numéricos alinhados à direita.

## Históricos e detalhamento

- [x] Simplificar a linha principal do Histórico de Entregas: data, loja/localidade, equipe, tipo de transporte, números e ações; remover motivos e observações da linha.
- [x] Fazer cada número de realizadas/não realizadas abrir seu próprio detalhe, separado por entrega/coleta e pelo estado clicado. Exemplo: em `18/9`, clicar em 18 abre somente as realizadas e em 9 somente as não realizadas daquele lançamento. As realizadas são mostradas como total coletivo, pois o Portal não guarda uma linha por entrega/coleta realizada.
- [x] Manter disponível o detalhe geral do lançamento na ação **Detalhes**, separado dos atalhos específicos de cada número.
- [x] Aplicar detalhamento por clique aos demais gráficos, históricos e indicadores gerenciais, incluindo o Histórico de Fretes. Os números de volume/peso, hodômetro e valores abrem a seção correspondente do frete.
- [x] Nos históricos de Entregas e Fretes e no ranking, manter o seletor de linhas e remover a rolagem vertical interna; a página passa a exibir toda a página selecionada de resultados.
- [x] Deixar os controles de paginação somente abaixo das tabelas dos históricos e do ranking.

## Fretes e cadastros

- [x] Ao selecionar um agregado, preencher a quantidade usando somente entregas realizadas da revisão confirmada do motorista/data; excluir não realizadas e coletas.
- [x] No cadastro de motorista **Terceirizada**, acrescentar a modalidade **Agregado** ou **Transportadora independente**.
- [x] Para transportadora independente, exigir seleção de **Paulo Cruz** ou **Just In Time**.
- [x] No lançamento de Fretes, listar como agregados somente motoristas classificados como **Terceirizada > Agregado**; selecionar a empresa para transportadoras independentes, sem duplicar seus motoristas como agregados.
- [ ] Classificar os motoristas terceirizados já cadastrados.

## Decisões em aberto para a revisão

- Confirmar com a Diretoria os parâmetros iniciais da Meta: indicador taxa de realização, 95%, configuração global e permissão para DIRETORIA/DEV global. O escopo das operações (Entregas, Coletas ou ambas) e a periodicidade são configuráveis.
- Se o diretor também quer separar os motivos por ajudante além do motorista que lidera a equipe. Os lançamentos atuais registram os motivos coletivamente e não atribuem a ocorrência a uma pessoa específica.
- Se existe fonte para detalhar cada entrega realizada individualmente; o Portal atualmente registra totais agregados por lançamento/equipe.
- Se existe fonte para detalhar cada entrega realizada individualmente; o Portal registra totais agregados por lançamento/equipe e o detalhe explica esse limite.
- Quem classificará os motoristas terceirizados existentes, se um motorista pode mudar ou pertencer a mais de uma transportadora e se a nova subdivisão altera os indicadores de Entregas.
- Os campos de modalidade e empresa são limpos quando o tipo base muda para **Própria** ou para **Ajudante**.

## Implementação desta rodada — 09/11/2026

- O Histórico de Entregas mostra contagens clicáveis por operação e estado. O detalhe específico filtra o item, preserva o histórico de alterações e, para não realizadas, apresenta somente as ocorrências daquela operação; o botão geral **Detalhes** continua abrindo todos os dados.
- O Histórico de Fretes abre os detalhes de operação, hodômetro ou valores a partir dos números correspondentes e conserva os filtros ativos.
- A quantidade do frete agregado soma apenas `quantidade_realizada` dos itens de Entrega da revisão confirmada mais recente.
- O cadastro exige modalidade para motoristas terceirizados novos e permite classificar os existentes durante a edição. Valores antigos ficam nulos até confirmação manual; por isso não aparecem na lista de agregados antes da classificação.
- A migration aditiva `f9c2a7d81e64` acrescenta modalidade/empresa e uma constraint sem classificar dados antigos automaticamente. Ainda deve ser aplicada conforme o procedimento de publicação do banco de Logística.

## Estado da separação visual ampla

Vyctor avaliou que a separação visual ampla ficou ruim e pediu para manter o formato anterior. A reversão já foi aplicada nos gráficos gerais: totais, evolução do OTIF, composição, performance por loja, motivos, equipes e tipo de transporte aparecem agregados. A separação permanece nos detalhes de cada item, para que seja possível investigar Entregas e Coletas individualmente.

Os arquivos que concentram a visualização agregada e os detalhes são:

- `frontend/src/features/analytics/pages/ManagementDashboardPage.tsx` — cartões e gráficos gerais agregados; não recolocar os painéis separados sem uma nova revisão visual.
- `frontend/src/features/analytics/pages/ManagementDashboardPage.module.css` — aparência dos painéis gerais e da linha única de OTIF.
- `frontend/src/features/analytics/pages/DashboardDetailDialog.tsx` e `.module.css` — detalhes que continuam distinguindo Entregas e Coletas.
- `frontend/src/features/analytics/types.ts` e `frontend/src/features/analytics/demoApi.ts` — campos e dados da demonstração por operação.
- `backend/app/modules/analytics/schemas.py` e `backend/app/modules/analytics/service.py` — contratos e agregações do painel por operação.

Os campos agregados por operação no backend continuam necessários para os detalhes e para o ranking; não devem ser removidos ao ajustar apenas a aparência. A Meta, o alinhamento do ranking, os filtros e as interações também devem ser preservados.
