# Portal de Lançamento de Logística

## Objetivo

Reunir os registros diários da Logística em um portal, começando pelo Suporte e Entregas e avançando para outros setores. O portal deve facilitar os lançamentos e o acompanhamento dos resultados, mostrando a cada equipe apenas a área que lhe cabe.

## Módulos e trabalho realizado

- **Entregas:** permite registrar filial, data, motorista, ajudantes, quantidades, motivos e observações. Há rascunhos, confirmação, histórico, correções que preservam o lançamento anterior e cancelamentos justificados.
- **Feedback de clientes:** elogios e reclamações ligados a uma entrega confirmada, com consulta e exportação conforme o acesso concedido.
- **Painel e ranking:** reúne indicadores por período, filial, tipo de transporte e motivo. Motoristas e ajudantes aparecem no mesmo ranking; os resultados da equipe são compartilhados e não devem ser somados entre seus participantes.
- **Cadastros e administração:** mantém filiais, pessoas, motivos e acessos.

A atualização mais recente reúne entregas e coletas no mesmo registro, com quantidades e motivos separados por operação. A prévia do site e a validação automatizada passaram, e o ambiente de teste foi atualizado. Falta publicar a versão mais recente no site de teste e validar o fluxo completo.

## Pedidos do Vyctor

- Organizar a navegação lateral em pastas por setor. Diretoria e DEV podem navegar entre os setores autorizados; Vyctor pode filtrar as pastas que quer ver; cada pessoa de um setor entra diretamente na área correspondente e não vê as áreas dos demais.
- Manter entregas e coletas no mesmo registro, mas com contagens e motivos separados.
- Mostrar resultados por tipo de transporte e por grupo de motivo; exibir motivos das equipes como contexto no ranking.
- Criar o setor **Transporte**, começando pela página **Lançamento de Frete**. As demais páginas serão definidas conforme os materiais forem recebidos.
- Dentro de Transporte, criar uma pasta **Agregados** para as funções desse grupo, incluindo o relatório de valores a pagar.
- Permitir que a gestão selecione um período e gere um resumo de quanto pagar a cada agregado para enviar ao Financeiro.

## Novo setor: Transporte

O setor terá algumas páginas, como o Suporte. A primeira página confirmada é **Lançamento de Frete**. As outras serão definidas conforme os materiais e as planilhas forem recebidos e analisados. Dentro da pasta Transporte haverá uma pasta **Agregados** para as funções desse grupo.

O lançamento de Frete deve trazer para o portal a tabela usada hoje e calcular automaticamente o valor a registrar, usando a planilha de tarifas por cidade e as tabelas próprias de mais duas transportadoras independentes.

As transportadoras independentes poderão atualizar suas tabelas. Se uma delas adicionar uma coluna, cobrança ou seção, precisamos definir como incluir o campo correspondente no preenchimento do Portal. Também será preciso decidir quem pode editar cada tabela, quando novos valores passam a valer e como manter a explicação dos fretes antigos sem alterá-los silenciosamente.

O módulo também deve permitir que a gestão escolha um período entre duas datas e gere um relatório com cada agregado e o valor a pagar, pronto para encaminhar ao Financeiro. A regra de cálculo, os fretes que entram no período e o tratamento de cancelamentos, ajustes e pagamentos anteriores precisam ser combinados com as áreas responsáveis.

As pastas para subsetores do Suporte podem ser necessárias futuramente, mas essa organização ainda será confirmada.

Antes de implementar, precisamos conferir as planilhas e levantar cidades, fórmulas, cobranças adicionais, exceções, datas de vigência e regras para ajustes manuais.

## Próximas etapas

1. Publicar a versão atualizada no ambiente de teste e validar Entregas e Coletas, histórico, painel, ranking, cadastros e acessos.
2. Conferir com Suporte os cadastros oficiais de filiais, pessoas e motivos e concluir o piloto.
3. Validar arquivos de importação com exemplos anonimizados e definir o prazo de retenção de nomes e relatos de clientes antes de usar dados reais.
4. Levantar a tabela atual de Fretes e as três fontes de tarifas; aprovar exemplos de cálculo com seus responsáveis.
5. Definir como as transportadoras manterão suas tabelas e incluirão novos campos, sem afetar lançamentos anteriores.
6. Definir com a gestão e o Financeiro a regra de pagamento dos agregados e o formato do relatório por período.
7. Implementar o módulo de Fretes e o relatório de pagamentos junto com a navegação por setor.
8. Preparar produção separadamente, depois da validação e do aceite do piloto. O ambiente de produção ainda não está pronto.
