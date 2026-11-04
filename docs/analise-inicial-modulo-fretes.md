# Análise inicial das planilhas do módulo de Fretes

**Data da análise:** 29/10/2026
**Fontes:** os cinco arquivos recebidos em `docs/`.

## 1. Controle de Fretes

`CONTROLE DE LANÇAMENTOS.xlsx` tem a aba `LANÇAMENTO`, com 1.758 linhas históricas preenchidas e estes campos: data, transportador, rota/cidade, KM inicial, KM final, KM rodado, entregas, peso, valor da nota, frete bruto, `R$ AVARIA`, frete pago e percentual do frete. A coluna K, `R$ AVARIA`, registra um valor financeiro; a planilha não tem uma coluna para contar ocorrências de avaria. A quantidade de ocorrências mostrada no Portal é um dado separado, obtido das Entregas.

As fórmulas existentes são `KM rodado = KM final - KM inicial`, `frete pago = frete bruto - R$ AVARIA` e `% frete = frete bruto / valor da nota`. Há linhas com hodômetro incompleto e variações de escrita em transportadores e cidades; os dados antigos não devem ser importados até serem normalizados e conferidos.

Para novos lançamentos, a pessoa responsável anotará a leitura do hodômetro no início e no fim do serviço e digitará ambas no Portal. As duas leituras serão obrigatórias. O Portal calculará `KM rodado` pela diferença; esse total não será um campo digitado independentemente. Essa captura é manual por frete; a extração mensal de distância da Cobli para Gestão de Frota é um fluxo separado.

## Modalidade do transporte: próprio e agregado

O usuário confirmou que o módulo precisa registrar tanto transporte da frota própria quanto transporte feito por agregados. A coluna `transportador` da planilha contém nomes, mas não classifica de forma confiável a modalidade; não inferir próprio/agregado pelo nome, pela tabela escolhida ou pelo motorista.

Manter separados dois conceitos:

- **Tipo de transporte:** frota própria, agregado ou transportadora independente. O tipo é informado no lançamento; não inferir pelo nome ou pela fonte tarifária.
- **Fonte da tarifa:** tabela/regra usada para calcular um valor, como Agregados CD, JUST IN TIME ou Paulo Cruz. A fonte não determina o tipo de transporte.

O usuário definiu que o pagamento de agregados será calculado na página de pagamentos, somando os fretes registrados com tipo `AGREGADO` dentro do período escolhido. O lançamento não pede cadastro, nome ou CPF de um agregado individual, e o relatório não separa valores por recebedor.

As planilhas disponíveis não definem uma tarifa nem um método de apuração de custo para a frota própria. Também não classificam as linhas históricas por modalidade. Até essas regras serem confirmadas, não calcular nem exportar custo de transporte próprio como pagamento de agregado, e não classificar automaticamente o histórico.

## 2. Agregados CD

`TABELA DE FRETE AGREGADOS CD.xlsx` contém simuladores para RO, MC, MC S, CF, AR e CP, além de uma aba de cotação. Os simuladores combinam valor da nota, peso e quilômetros rodados. As fórmulas das linhas de exemplo apontam para células diferentes conforme a aba:

| Aba | % da nota efetivamente usada na fórmula de exemplo | R$/km | R$/kg |
|---|---:|---:|---:|
| RO | 1,17% | 6,32 | 0,06 |
| MC | 1,17% | 3,56 | 0,06 |
| MC S | 1,20% | 3,75 | 0,07 |
| CF | 1,20% | 3,75 | 0,07 |
| AR | 1,20% | 3,85 | 0,08 |
| CP | 1,20% | 3,95 | 0,08 |

O resultado do exemplo é a soma de `valor da nota × percentual`, `peso × valor por kg` e `km × valor por km`. O rótulo “Frete mínimo” aparece sem um valor preenchido; por isso, nenhum mínimo será aplicado até haver um valor aprovado.

Para o Portal, o usuário confirmou como corretos os valores do `initial_tariffs.json`, inclusive 1,2% para RO e MC. Os 1,17% acima registram a fórmula de exemplo observada na planilha; não substituem o percentual confirmado para o módulo. O frete mínimo continua sem valor aprovado.

As abas representam rotas/regiões, e não o catálogo de localidades do Portal. O mapeamento entre as cidades previstas e as abas registrado no JSON do módulo foi confirmado pelo usuário. Trajetos compostos e cidades que não constam no mapeamento ainda precisam de regra.

## 3. JUST IN TIME

`TABELA DE FRETE JUST IN TIME.xlsx` separa o frete base por 18 zonas e faixas de peso, lista adicionais dependentes do peso e apresenta uma tabela de armazenagem/movimentação de pallets.

Os rótulos de peso têm limites sobrepostos em alguns pontos (por exemplo, 100 kg e 500 kg); há intervalos ausentes na tabela de adicionais. A observação da planilha pede negociação quando mais de um adicional se aplica à mesma entrega. “Embalagem de caixas” e “movimentação de pallet” estão “a combinar”, sem preço.

## 4. Paulo Cruz

`TABELA DE FRETE PAULO CRUZ.xlsx` informa fretes fixos por tipo de caminhão: Saveiro (R$ 300), Kia Bongo (R$ 500), caminhão 3/4 (R$ 950 para 1.500–4.000 kg) e caminhão toco (R$ 1.100 para 4.001–9.000 kg). A tabela não define qual veículo escolher quando a carga excede os limites ou não se encaixa nas faixas.

## 5. Solicitação de Pagamento

`Solicitação de Pagamento AGREGADOS.xlsx` contém campos de pagamento extra (data, nome, CPF, motivo, setor, valor total e observações), mas o fluxo definido para este módulo é diferente: a página de pagamentos consolida os lançamentos com tipo `AGREGADO` no período escolhido. Não haverá cadastro de agregado, CPF nem vínculo individual no lançamento; o CSV gerado pelo Portal apresenta os totais consolidados.

## Mapeamento inicial do módulo

| Informação operacional | Origem | Tratamento inicial no Portal |
|---|---|---|
| Data do serviço | Controle de Fretes | Data usada na consulta por período, sujeita à confirmação do Financeiro. |
| Modalidade do transporte | Confirmação do usuário; não identificada no controle histórico | Registrar explicitamente se foi frota própria ou serviço terceirizado; não inferir pelo nome. |
| Transportador/responsável pela execução | Campo `transportador` do Controle de Fretes | Manter separado do tipo de transporte e normalizar nomes antes de importar histórico. |
| Tipo de transporte | Informado no Portal | Somar na página de pagamentos somente os fretes registrados com tipo `AGREGADO`; não identificar um recebedor individual. |
| Rota/cidade, hodômetros, entregas, peso e valor da nota | Controle de Fretes para histórico; leitura manual no lançamento futuro | A pessoa responsável digita KM inicial e final no Portal; o sistema deriva KM rodado. |
| Fonte da tarifa e parâmetros | Tabelas JUST IN TIME, Paulo Cruz e Agregados CD | Cálculo separado por fonte, com cópia dos parâmetros usados no lançamento; não usar a fonte para inferir o tipo de transporte. |
| Frete bruto, valor da avaria e líquido | Controle de Fretes | Frete bruto calculado ou marcado para conferência; líquido = bruto − valor da avaria (R$). |
| Pagamento por período | Fretes com tipo `AGREGADO` | Somar valores calculados pela data do serviço; manter fretes próprios e transportadoras fora desse relatório. |

## Pendências para liberação do cálculo e do relatório

1. Percentuais de tarifa do JSON confirmados, inclusive RO e MC em 1,2%; o valor do frete mínimo continua pendente porque a planilha não o informa.
2. Confirmar a data que define o período do relatório: serviço ou lançamento.
3. Definir como resolver os limites sobrepostos e os intervalos faltantes de peso na tabela JUST IN TIME.
4. Definir o tratamento para dois ou mais adicionais JUST IN TIME e para itens de armazenagem com valor “a combinar”.
5. O mapeamento previsto de cidade para aba Agregados CD está confirmado; definir o tratamento de trajetos compostos e cidades fora do mapeamento.
6. Definir a seleção de veículo Paulo Cruz fora das faixas declaradas.
7. Confirmar como tratar fretes já pagos, avarias, lançamentos cancelados e pagamentos extras no relatório.
8. Validar exemplos com cada responsável antes de usar os valores calculados em pagamento real.
9. Definir como registrar e apurar eventual custo da frota própria. Nenhuma das planilhas analisadas fornece essa regra ou uma tarifa própria.
10. Classificar o campo histórico `transportador` em tipo de transporte somente após conferência; a planilha não permite inferir esse tipo com segurança.

Nenhuma linha histórica de controle ou CPF dos exemplos foi importada para o banco. As planilhas originais permanecem como referência para conferência.
