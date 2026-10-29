# Requisitos futuros do Portal: navegação por setor e lançamento de fretes

**Status:** requisito futuro para implementar junto com o setor Transporte. A possível subdivisão do Suporte continua sujeita a confirmação. Não faz parte da alteração atual.

## Objetivo

Organizar a navegação lateral do Portal por setor. Cada setor terá uma pasta própria, contendo as páginas e funções daquele setor que já existem ou forem adicionadas ao Portal.

## Comportamento esperado

- **Diretoria e DEV:** podem navegar entre os setores que estão autorizados a consultar. A barra lateral mostra uma pasta por setor e, dentro dela, as páginas e funções correspondentes. As páginas que já existem devem ser organizadas nas pastas dos setores apropriados.
- **Vyctor, Diretor de Logística:** além das pastas por setor, terá um filtro para escolher quais setores aparecem na barra lateral. O filtro controla a exibição da navegação e não concede permissões novas.
- **Usuário de um setor:** ao entrar no Portal, é encaminhado automaticamente à área do seu setor. A barra lateral mostra somente as páginas e funções daquele setor; não deve exibir as pastas dos outros setores.
- Ao adicionar um novo módulo de lançamento, incluir suas páginas na pasta do setor correspondente e configurar o destino inicial dos usuários desse setor.
- **Setor Transporte:** terá sua própria pasta e poderá conter várias páginas, seguindo a organização já usada para o Suporte. A primeira página confirmada é **Lançamento de Frete**. Dentro de Transporte haverá também uma pasta **Agregados** para páginas e funções relacionadas a agregados, incluindo o relatório de valores a pagar.
- As outras páginas de Transporte serão definidas conforme os materiais e planilhas forem recebidos e analisados. Criar pastas para subsetores do Suporte é uma possibilidade futura a confirmar, não um requisito já fechado.

## Regras de acesso

A interface deve mostrar somente recursos compatíveis com as permissões e escopos do usuário. Ocultar pastas na barra lateral não substitui a autorização no backend: a API deve continuar verificando setor, recurso, ação e escopo em cada operação.

O filtro do Diretor pode restringir o que aparece na navegação, mas nunca ampliar o acesso concedido. Para contas com acesso a mais de um setor que não sejam Diretoria ou DEV, definir durante a implementação se haverá uma seleção inicial de setor ou outra regra explícita de destino.

## Critérios de aceite

1. Os recursos existentes e os do novo módulo aparecem agrupados sob as pastas de seus setores.
2. Diretoria e DEV conseguem navegar entre os setores autorizados.
3. Vyctor consegue filtrar as pastas visíveis por setor sem alterar suas permissões.
4. Uma conta restrita a um setor entra diretamente na área desse setor e não vê pastas de outros setores.
5. Acesso direto a uma rota ou chamada de API não autorizada continua sendo negado pelo backend.

## Momento de implementação

Implementar a navegação por setor junto com o setor Transporte, incluindo a pasta **Agregados**, a estrutura da barra lateral, o destino após login e o filtro da Diretoria. Criar pastas para subsetores do Suporte somente se essa organização for confirmada.

## Setor Transporte: lançamento e cálculo de fretes

O setor do lançamento de frete é **Transporte**. A primeira página confirmada é **Lançamento de Frete**; outras páginas serão definidas depois. Converter para o Portal a tabela atualmente usada para lançar dados de frete. No mesmo fluxo, incluir um cálculo automático do valor que deve ser registrado, usando as planilhas de tarifas e regras por cidade. Analisar cada planilha recebida para entender suas regras antes de implementar os cálculos.

### Escopo registrado

- Levantar a tabela atual de lançamento e converter seus campos e fluxo para o módulo de Fretes do Portal.
- Calcular o frete da tabela-base a partir da cidade de entrega e das regras registradas na planilha de cálculo por cidade.
- Incluir o cálculo para mais duas transportadoras externas, cada uma usando sua própria tabela de tarifas.
- No lançamento, identificar a transportadora e calcular o valor conforme a tabela e as regras correspondentes. O cálculo deve ocorrer no próprio fluxo de registro.
- Guardar a transportadora e a base usada no cálculo junto ao valor lançado, para que seja possível conferir de onde veio o valor.
- Tratar cidade ou combinação sem tarifa válida como pendência de conferência; não gravar zero nem escolher uma tarifa aproximada automaticamente.
- Incluir uma consulta para a gestão selecionar um período entre duas datas e gerar um relatório do valor a pagar a cada agregado, para encaminhamento ao Financeiro.
- Colocar a consulta e o relatório de pagamentos dentro de **Transporte > Agregados**. As demais páginas dessa pasta serão definidas conforme o processo de agregados for detalhado.

### Atualização das tabelas pelas transportadoras independentes

As duas transportadoras independentes podem atualizar suas próprias tabelas. O Portal deve permitir que pessoas autorizadas mantenham os valores e que a área de tarifas possa acompanhar mudanças nas planilhas, como uma nova coluna, cobrança ou informação.

Quando surgir um novo campo na tabela da transportadora, deve haver uma forma correspondente de incluí-lo no preenchimento do frete. O caminho exato precisa ser desenhado junto com o módulo: queremos que a manutenção acompanhe novas colunas e seções sem exigir uma reconstrução completa do lançamento a cada alteração, preservando regras claras de preenchimento e cálculo.

Também será preciso definir quem pode alterar cada tabela, quando uma nova tarifa passa a valer, como registrar as mudanças e como manter a explicação dos valores de fretes já lançados. Atualizar uma tabela não deve mudar silenciosamente os valores históricos.

### Informações a levantar antes da implementação

- A tabela atual de lançamento e as planilhas vigentes das três fontes de tarifa.
- Campos, fórmulas, unidades, adicionais, exceções por cidade e eventuais datas de vigência de cada tabela.
- Como as transportadoras independentes avisarão e cadastrarão novas colunas, cobranças ou seções, e quais delas entram no cálculo.
- Como a cidade da planilha será associada ao cadastro oficial de localidades do Portal.
- Como o usuário escolhe a transportadora e se o sistema pode sugeri-la.
- Quais pessoas de cada transportadora poderão alterar sua tabela e quais aprovações serão necessárias.
- Se o usuário poderá ajustar manualmente o valor calculado e quais permissões, justificativa e trilha de auditoria serão exigidas.
- Se será necessário importar o histórico da tabela atual.
- Qual regra define o valor devido a cada agregado, quais lançamentos entram no período, qual data determina o período e como tratar cancelamentos, ajustes e pagamentos já realizados.
- Quais informações e formato o Financeiro precisa receber no relatório de pagamentos.

### Critérios de aceite do cálculo de frete

1. Para uma mesma cidade e transportadora, o sistema aplica a tabela e a regra vigentes daquela fonte.
2. As três fontes de tarifa são separadas e identificáveis; não há mistura de regras entre transportadoras.
3. O valor calculado e sua origem ficam associados ao lançamento para conferência posterior.
4. Cidade ou tarifa sem correspondência fica sinalizada e exige tratamento definido, sem substituição silenciosa por zero ou aproximação.
5. Os cálculos são conferidos com exemplos aprovados pelas pessoas responsáveis pelas planilhas antes do uso operacional.
6. Uma transportadora autorizada consegue atualizar sua própria tabela e incluir um novo campo ou seção pelo processo definido, sem afetar as tabelas das outras transportadoras nem alterar silenciosamente lançamentos anteriores.
7. A gestão consegue escolher duas datas e gerar um relatório conferível com cada agregado e o valor devido no período, pronto para encaminhar ao Financeiro.
