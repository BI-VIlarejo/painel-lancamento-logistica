# Módulo de Fretes — plano atualizado em 06/11/2026

**Atualizado em:** 06/11/2026
**Objetivo:** registrar o estado da implementação, as regras que ainda dependem de decisão e os pré-requisitos para publicar em staging.

## Retomada de 05/11/2026 — publicar em staging

Estado conferido em 04/11: o código do Portal está em `staging` e sincronizado com `origin` até `23582fc`; as migrations `f8a2d6c1e407` e `c7e3a91b5d42` estão em `VilarejoBI/logistica`, no commit `416eecf`, também sincronizado com `origin`. A migration anterior `d4e7c9b2a610` faz parte da cadeia. A implantação da API e a aplicação das migrations em staging ainda não foram confirmadas. O resultado do CI depois do commit `23582fc` também precisa ser conferido.

Faça nesta ordem:

1. [ ] No GitHub Actions, confirme que o CI do `staging` passou depois do commit `23582fc`. Se falhar, corrigir e enviar somente os arquivos necessários.
2. [ ] No Vercel, confirme que há um Preview `Ready` para o commit atual do `staging`; o frontend é publicado separadamente da API.
3. [ ] Antes de alterar o banco, confirme o banco/ambiente de staging, a revisão atual do Alembic e um snapshot recente do RDS. O deploy da API não executa migrations; o perfil usado anteriormente não tinha `rds:DescribeDBInstances`.
4. [ ] Aplicar e conferir, na cadeia `logistica`, as migrations pendentes na ordem `d4e7c9b2a610` → `f8a2d6c1e407` → `c7e3a91b5d42`. Não aplicar em produção.
5. [ ] Com CI verde e banco atualizado, executar manualmente no GitHub Actions **Deploy Portal API to Staging** e conferir o resultado/health da API.
6. [ ] Confirmar no banco de staging o setor/escopo `TRANSPORTE` e as permissões de Fretes para a conta de suporte que fará a validação.
7. [ ] Abrir o portal pelo Preview e validar login, menu Transporte, seleção de motorista terceirizado, preenchimento vindo de Entregas, lançamento, histórico e pagamentos. Registrar problemas antes de liberar para uso operacional.

**Ainda fora desta publicação:** a tela administrativa para reajustar tarifas não foi implementada; regras financeiras que seguem pendentes estão listadas abaixo. Não liberar produção até o aceite do staging.

## Escopo operacional confirmado — 04/11/2026, com revisões de 06/11/2026

- Novos lançamentos não oferecem a modalidade **Frota própria**. O tipo pode continuar no banco e no histórico apenas para compatibilidade com registros antigos.
- Agregados são motoristas cadastrados em **Equipes** como `MOTORISTA`, `TERCEIRIZADA` e modalidade **Agregado**. A modalidade terceirizada também precisa distinguir **Transportadora independente** e, nesse caso, indicar **Paulo Cruz** ou **Just In Time**.
- Ao escolher data e motorista, o formulário busca a última revisão confirmada das Entregas desse dia e preenche cidade/rota, quantidade de entregas **realizadas** e quantidade de avarias (`AVARIA`). Entregas não realizadas e coletas não entram na quantidade de entregas usada no frete.
- [x] Correção solicitada em 06/11/2026: o resumo usa somente `quantidade_realizada` da revisão confirmada do motorista/data e não soma entregas não realizadas nem coletas.
- [x] Alteração solicitada em 06/11/2026: o cadastro de motorista `TERCEIRIZADA` salva modalidade **Agregado** ou **Transportadora independente**; a segunda exige empresa **Paulo Cruz** ou **Just In Time**. O seletor de agregado aceita somente motoristas classificados como agregado.
- [ ] Revisar e classificar os registros terceirizados já existentes; definir com a operação quem confirma essa classificação antes de habilitar o novo filtro.
- [x] No Histórico de Fretes, tornar os números de volume/peso, hodômetro e valores pontos de entrada para as seções correspondentes, preservando período/filtros e o detalhe geral. A memória tarifária completa continua fora do diálogo.
- A quantidade de ocorrências `AVARIA` vinda das Entregas é informativa e separada do campo financeiro. O controle `CONTROLE DE LANÇAMENTOS.xlsx`, coluna K (`R$ AVARIA`), registra o valor em reais descontado do frete; por isso o Portal mantém esse valor no lançamento.
- A API recalcula os dados derivados das Entregas antes de cotar e gravar o frete.
- O código do Portal e as migrations de Fretes estão enviados às respectivas branches de staging (`LancamentoLogistica/staging` e `VilarejoBI/logistica`). O CI após `23582fc`, a aplicação das migrations, o deploy da API e a conferência visual ainda precisam ser confirmados; seguir o checklist acima.

## Solicitações novas da diretoria e da operação — 04/11/2026

- [ ] **Administração de tarifas:** incluir na administração do Portal uma área para reajustar os valores de Agregados CD e das transportadoras independentes (JUST IN TIME e Paulo Cruz). Antes de liberar a edição, definir quais perfis podem alterar os valores, quando cada alteração entra em vigor, como auditar autor/data/valores anteriores e se o reajuste afeta apenas novas cotações. Fretes já lançados devem conservar a memória e o valor calculados originalmente. A alteração de tarifas ainda não foi implementada.
- [ ] **Organização dos cadastros:** manter todos os cadastros na área **Cadastros** da Administração. Avaliar separar ou filtrar os catálogos por setor para que cada equipe encontre os registros da sua operação sem misturar cadastros de áreas diferentes.
- [ ] **Seleção de agregados:** manter o cadastro existente de equipes, mas filtrar somente motoristas `MOTORISTA / TERCEIRIZADA / AGREGADO`. Não exibir motoristas classificados como `TRANSPORTADORA_INDEPENDENTE` como agregados; registrar a empresa associada (Paulo Cruz ou Just In Time) no cadastro.
- [x] **Hodômetro de transportadora independente:** o formulário não solicita KM inicial, KM final nem KM rodado para esse tipo. O backend aceita esses campos nulos apenas em conjunto; agregados continuam informando hodômetro. A modalidade própria pode aparecer somente em registros legados.
- [x] **Pagamentos por responsável:** a página permite filtrar e exportar por modalidade e responsável: transportadora independente ou agregado selecionado no cadastro de equipes. Dados legados sem nome continuam no filtro “Sem identificação”.

Estas solicitações substituem, para lançamentos futuros, as regras históricas abaixo que dispensavam o nome individual do agregado, consolidavam pagamentos sem separação por responsável e incluíam frota própria. Os registros históricos permanecem para rastreabilidade.

## Estado registrado em 03/11/2026 (histórico)

- [x] Lançamento, histórico, cálculo inicial e relatório/CSV por responsável implementados para a API real e demonstração.
- [x] Testes novos cobrem fórmulas e arredondamento, faixas sobrepostas/vazias, permissões por escopo e ação, CSRF, idempotência, relatório e exportação; as verificações locais e o build passaram.
- [x] Frete Paulo Cruz para Saveiro e Kia Bongo fica pendente até haver limites de peso aprovados. Faixas JUST IN TIME ambíguas, sem preço ou sem correspondência também ficam pendentes sem valor inventado.
- [x] A cadeia completa foi aplicada e repetida em MySQL de teste: `b17d4e82c906` → `d4e7c9b2a610` → `f8a2d6c1e407`.
- [ ] A migration `c7e3a91b5d42` foi atualizada localmente para adicionar o vínculo do motorista agregado, a quantidade de avarias e seus índices/restrições; ainda não foi aplicada nem validada em staging.
- [ ] Em staging, Alembic ainda confirma `b17d4e82c906`; as migrations não foram aplicadas. A leitura de inventário RDS foi negada ao perfil IAM da instância (`rds:DescribeDBInstances`), então não foi possível confirmar se há snapshot recente. Um responsável com acesso RDS precisa verificar ou criar o snapshot primeiro.
- [ ] Confirmar o CI dos commits, provisionar setor/permissões de Transporte e publicar a API atualizada em staging.
- [ ] Continuam pendentes decisões do Financeiro e da operação: trajetos compostos, pagamentos efetivamente realizados e extras, formato XLSX e edição/cancelamento.
- [ ] Fretes não usa dados reais nem depende de custos ou limites inventados enquanto as decisões acima estiverem abertas.

Esta atualização substitui o roteiro operacional abaixo, datado de 30/10. As regras históricas confirmadas nessa data permanecem registradas.

## Registro de implementação anterior

- [x] Backend inicial de Fretes criado no Portal: modelos, schemas, repository, service, router, calculadora, catálogo de tarifas e `initial_tariffs.json`.
- [x] Router da API, registro ORM, permissões, bootstrap local e provisionamento de desenvolvimento integrados ao backend.
- [x] DBML atualizado com frete e eventos; o motorista agregado é vinculado ao cadastro de equipes e o nome é gravado como fotografia, sem CPF.
- [x] No frontend, `types.ts`, `api.ts` e `demoApi.ts` cobrem os contratos do módulo Fretes.
- [x] A primeira versão selecionava como agregado qualquer motorista cadastrado como entrega terceirizada. Essa regra foi revisada em 06/11/2026: passa a ser necessário filtrar pela modalidade **Agregado**; ver pendência acima. Registros anteriores sem nome seguem válidos como “Sem identificação”.
- [x] A migration Alembic existe em `VilarejoBI/alembic/versions/logistica/f8a2d6c1e407_create_freight_tables.py`. É uma revisão da cadeia compartilhada `logistica`, encadeada após `d4e7c9b2a610`; não criar uma segunda cadeia no Portal.
- [x] O usuário confirmou as cidades e os valores de tarifa registrados no `initial_tariffs.json`, incluindo RO e MC em 1,2%.
- [x] O usuário confirmou a matriz de perfis atual do catálogo de permissões.
- [x] A captura de KM permanece manual para frota própria e agregados: a pessoa responsável digita KM inicial e final no Portal, e o sistema deriva KM rodado. Transportadoras independentes não informam hodômetro.
- [ ] As regras de Paulo Cruz para Saveiro e Kia Bongo e os limites de peso precisam ser conferidos antes de liberar esses cálculos.
- [x] O relatório e o CSV de pagamento filtram por período, modalidade e nome da transportadora/agregado. Registros legados de agregado sem nome podem ser consultados separadamente.
- [x] A migration `f8a2d6c1e407` foi revisada e encadeada depois da migration `d4e7c9b2a610`; sua aplicação em staging aguarda snapshot e CI.
- [x] A análise registra os valores aprovados do JSON e preserva 1,17% somente como observação da fórmula de exemplo da planilha.
- [x] Lançamento, histórico e pagamentos separados por modalidade: frota própria, agregado e transportadora independente.
- [x] Frota própria não exige vínculo com agregado, não recebe custo inventado e fica fora do relatório de pagamentos de agregados enquanto não houver regra aprovada.
- [x] Relatório financeiro soma os fretes da modalidade e do responsável selecionados; o período usa a data do serviço e o CSV apresenta o responsável e seus totais.
- [x] Histórico mostra data, tipo de transporte e nome do agregado/transportadora; não exibe código técnico do frete.
- [x] Filtros do histórico ocupam a largura disponível; a tabela tem largura mínima reduzida para se ajustar melhor quando a área muda com o menu lateral.
- [x] ORM, schemas, API, modo demonstração, DBML e migration guardam o nome de agregado como texto, sem cadastro, CPF ou vínculo individual.
- [x] Páginas de lançamento, histórico e pagamentos usam medidas visuais comuns; formulário JUST IN TIME organiza zona e adicionais em cartões alinhados.
- [x] A migration foi validada e aplicada em MySQL temporário; staging permanece em `b17d4e82c906` e ainda não foi alterado.
- [x] Testes específicos de cálculo, serviço e endpoints HTTP criados e executados.

## Regras extraídas das planilhas

Estas regras já podem orientar a implementação:

- **Agregados CD:** frete bruto = percentual da nota + tarifa por kg + tarifa por km. RO e MC usam **1,2%**, conforme confirmação do usuário, mesmo que a fórmula de exemplo na planilha aponte para uma célula de 1,17%. As outras taxas regionais permanecem como registradas em `initial_tariffs.json`.
- **Frete mínimo:** as planilhas exibem o rótulo, mas não têm valor numérico preenchido. Não aplicar mínimo sem um valor aprovado.
- **JUST IN TIME:** calcular apenas quando houver uma faixa única. Limites sobrepostos, intervalos sem tarifa e faixas sem preço ficam pendentes de conferência. Mais de um adicional no mesmo local exige negociação; não somar automaticamente. Armazenagem e movimentação são cobranças separadas.
- **Paulo Cruz:** Saveiro R$ 300, Kia Bongo R$ 500, caminhão 3/4 R$ 950 entre 1.500 e 4.000 kg e toco R$ 1.100 entre 4.001 e 9.000 kg. A planilha não publica limite numérico para Saveiro e Kia Bongo; não inventar um.
- **Controle de lançamentos:** a pessoa responsável informa KM inicial e final para frota própria e agregados; o Portal deriva KM rodado = KM final − KM inicial. Transportadoras independentes não preenchem hodômetro. `Frete pago = frete bruto − R$ AVARIA` e `percentual = frete bruto ÷ valor da nota` são fórmulas observadas no controle histórico; a aplicação delas a transporte próprio ainda precisa de confirmação.
- **Modalidade:** o Portal deve atender frota própria e serviço terceirizado. A planilha histórica não classifica cada transportador. A modalidade precisa ser informada e não pode ser inferida pelo nome ou pela tabela de tarifa.
- **Fonte tarifária:** é independente do tipo de transporte. As tarifas existentes documentam tabelas de terceiros; não há tarifa ou regra de custo aprovada para frota própria.
- **Pagamento de agregados e transportadoras:** a página calcula o total pelos serviços no período e permite selecionar modalidade e responsável. O nome do agregado/transportadora aparece no CSV; os registros de agregado sem nome ficam disponíveis em “Sem identificação”. Frota própria permanece fora do relatório.

## Roteiro de trabalho para amanhã

### 1. Reabrir e proteger o estado dos repositórios

- [ ] Conferir `git status` separadamente em `LancamentoLogistica` e `VilarejoBI`.
- [ ] Não usar `git add -A`: ambos os repositórios têm arquivos pendentes que não pertencem necessariamente a Fretes.
- [x] Remover o cadastro de agregado individual e a seleção de recebedor do lançamento e do relatório.
- [x] Atualizar `docs/analise-inicial-modulo-fretes.md` para registrar os valores confirmados do JSON e manter a observação histórica da fórmula da planilha.

### 2. Confirmar decisões operacionais que ainda afetam telas e relatório

- [x] O usuário confirmou que há frota própria além de agregados; o módulo deve suportar ambas as modalidades.
- [ ] Definir como identificar veículo/motorista da frota própria e como apurar seu custo. As planilhas não trazem tarifa própria.
- [ ] Confirmar quais fontes tarifárias se aplicam a cada modalidade e quais valores são apenas pagamentos a terceiros.
- [ ] Conferir cada valor histórico de `TRANSPORTADOR`; não tratá-lo automaticamente como fonte da tarifa, modalidade ou agregado recebedor.
- [x] Confirmar o mapeamento atual das cidades para as tarifas Agregados CD.
- [ ] Definir o tratamento de trajetos compostos e cidades sem associação no JSON.
- [ ] Confirmar se o período financeiro usa `data_servico` ou `criado_em`; o backend atual filtra por `data_servico`.
- [ ] Definir se o relatório considera pagamentos já feitos, cancelamentos e pagamentos extras. O backend atual consolida fretes calculados, subtrai avarias e conta pendências separadamente.
- [ ] Confirmar se CSV atende ao Financeiro ou se o arquivo precisa ser XLSX. A API atual exporta CSV.
- [x] Confirmar a matriz de perfis e permissões conforme o catálogo atual do backend.
- [ ] Confirmar se o primeiro release precisa editar ou cancelar fretes. Hoje a API cria e consulta lançamentos.
- [x] Confirmar que o pagamento de agregados será calculado a partir do tipo de transporte e do período, sem vínculo individual ou CPF.

### 3. Avançar no frontend em ordem, validando cada etapa

1. [x] Separar tipo de transporte e fonte tarifária; identificar o agregado por nome livre, sem cadastro de pessoa ou CPF.
2. [x] Ajustar DBML, ORM e migration para remover cadastro e vínculo individual de agregado.
3. [x] Adaptar contratos, serviços, formulário e demonstração para selecionar a modalidade. O fluxo próprio não entra no pagamento de agregados.
4. [x] Adaptar o histórico para mostrar data, modalidade e responsável.
5. [x] Consolidar pagamentos por período, modalidade e responsável selecionados; manter opção para agregados antigos sem identificação.
6. [x] Manter a preferência do usuário: apresentar o escopo e validar cada bloco antes de iniciar mudanças futuras que não tenham sido autorizadas.

O usuário autorizou este bloco de código explicitamente. A migration continua sem aplicação. Não foram executados testes nem build nesta etapa.

Após cada componente ou integração, apresentar os arquivos alterados para validação antes de iniciar a próxima etapa.

### 4. Revisar e preparar a migration Alembic

- [x] Revisar `VilarejoBI/alembic/versions/logistica/f8a2d6c1e407_create_freight_tables.py` contra os modelos do Portal e o DBML; a revisão não cria cadastro ou vínculo individual de agregado.
- [x] Confirmar a revisão atual da cadeia `logistica` em staging com `alembic current`: `b17d4e82c906`.
- [ ] Antes de aplicar qualquer migration, confirmar ambiente, banco de staging e snapshot disponível.
- [ ] Aplicar `upgrade head` somente depois de confirmar a revisão atual e todas as revisões pendentes da cadeia; depois verificar que `f8a2d6c1e407` é a revisão atual.
- [ ] Não aplicar em produção nesta etapa.
- [ ] No repositório VilarejoBI, publicar as migrations de Fretes na ordem: `f8a2d6c1e407_create_freight_tables.py` e `c7e3a91b5d42_allow_freight_parties_and_optional_odometer.py`; não incluir as outras alterações desse repositório.

### 5. Revisar as alterações e os commits

- [ ] Após cada implementação, revisar o diff e validar com o usuário antes de prosseguir.
- [ ] Manter commits separados para planilhas de origem, backend/DBML, cliente e modo demo do frontend e páginas do frontend.
- [ ] Manter o commit da migration separado, no repositório VilarejoBI.
- [ ] Atualizar esta lista ao concluir ou mudar cada etapa.

## Validações automatizadas a planejar

- [ ] Criar testes da calculadora para fórmulas, faixas, arredondamento e casos pendentes.
- [ ] Criar testes do service para autorização, idempotência e consolidação do relatório.
- [ ] Criar testes do router para contratos, CSRF e permissões de consulta/exportação.
- [ ] Executar validação da migration em ambiente de desenvolvimento/staging antes de qualquer uso em produção.
