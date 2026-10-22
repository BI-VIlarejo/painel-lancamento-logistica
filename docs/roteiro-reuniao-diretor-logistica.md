# Roteiro de reunião com o Diretor de Logística

**Objetivo:** apresentar o estado atual do Portal de Logística, confirmar as regras de negócio e sair com responsáveis e próximos passos para um piloto.

## Situação atual para contextualizar

- O fluxo de Entregas cobre lançamento, rascunho, confirmação, histórico, correção e cancelamento.
- O setor responsável por novos lançamentos desse módulo é `SUPORTE` (Suporte); registros históricos não são reatribuídos automaticamente.
- O portal já tem telas conectadas à API para autenticação, catálogos, feedback, painel, ranking, administração e auditoria.
- Há um modo de demonstração com dados fictícios e uma configuração local com frontend, API e MySQL isolado. A demonstração não representa dados reais da operação.
- O cadastro de lojas/filiais é próprio do Portal. O schema de staging foi atualizado, mas os catálogos reais de lojas, pessoas e motivos ainda estão vazios.
- A publicação em Vercel e AWS ainda depende de domínio, ambiente de API, conectividade aprovada com o banco e configuração dos responsáveis de Infra.

## Agenda sugerida

1. Mostrar o fluxo atual de Entregas e o painel.
2. Confirmar como o processo funciona na operação e quais exceções precisam ser cobertas.
3. Validar a apresentação dos indicadores e do ranking e fechar a política de retenção do feedback.
4. Definir o piloto, as fontes de dados e quem responde por cada etapa.
5. Listar o que precisa ser encaminhado a Infra para a publicação.

## Perguntas para fechar com o Diretor

### 1. Escopo e piloto

- Para o primeiro piloto, o que precisa estar disponível: Entregas, feedback, painel, ranking e administração de usuários? Há algo que pode ficar para depois?
- Quais lojas ou equipes devem participar do piloto e por quanto tempo?
- Qual processo atual deve continuar em paralelo durante o piloto?
- Que resultado indicará que o piloto está pronto para ampliar o uso: completude dos lançamentos, redução de retrabalho, tempo de preenchimento ou outro critério?
- Quem será o responsável operacional para reunir dúvidas e validar correções durante o piloto?

### 2. Como um lançamento representa a operação

- Um lançamento representa um dia e uma equipe por loja, uma rota ou outra unidade de trabalho?
- Pode haver mais de um lançamento para a mesma loja e data? Em quais situações?
- Quando uma equipe ou motorista muda durante o dia, como isso deve aparecer no histórico?
- O motorista confirma o próprio lançamento ao terminar? Há algum caso que precisa de revisão por outra pessoa?
- Quem pode corrigir ou cancelar um lançamento já confirmado, e quais justificativas devem ser exigidas?
- Quais campos são obrigatórios mesmo quando a informação operacional não estiver disponível?

### 3. Lojas, pessoas, motivos e histórico

- Qual é a lista oficial de lojas/filiais, incluindo código, nome, cidade e UF? Quem pode aprová-la e mantê-la atualizada?
- Quem fornecerá e validará os cadastros de motoristas, ajudantes e motivos de não entrega?
- Existe uma amostra anonimizada do CSV histórico de Entregas? Quais colunas e convenções devemos preservar?
- Como os motivos e observações são preenchidos hoje? Há abreviações ou categorias que precisam ser mapeadas?
- O histórico antigo deve ser importado para o Portal ou ficará somente para consulta no sistema atual?

### 4. Indicadores e ranking

- Regra alinhada: OTIF = entregas não realizadas ÷ total registrado. O painel mostrará o indicador geral e por motorista, equipe e loja; confirme se esse recorte atende à gestão.
- As colunas de prazo e completude deixam de ser coletadas. Confirme se há alguma informação operacional adicional que precise aparecer no relatório.
- Metas e faixas de cor do OTIF ficam fora do primeiro piloto. Em que momento depois do piloto devemos reavaliá-las?
- O ranking já está definido como misto, com motoristas e ajudantes. A posição ordena por taxa de realização, score de atendimento, volume realizado e nome; os volumes apresentados por pessoa representam as equipes em que ela trabalhou. Essa leitura fica clara para a gestão?
- Há um volume mínimo ou outro critério de desempate que a gestão queira considerar depois de observar os dados do piloto?
- Quais filtros e períodos são mais úteis para a gestão?
- O volume realizado por equipe deve aparecer como resultado coletivo, sem ser apresentado como produtividade individual de cada participante?

### 5. Feedback de clientes

- O nome do cliente está definido como obrigatório; por quanto tempo nome e relato devem ser mantidos, e depois devem ser apagados ou anonimizados?
- Todos os perfis do piloto podem consultar e exportar feedback dentro dos escopos; OPERADOR também pode registrar e importar. Esse acesso atende à rotina da equipe?
- Por quanto tempo os relatos devem ser mantidos e quem será responsável por atender reclamações?
- O score de atendimento entra no ranking misto como +1 por elogio e −1 por reclamação para cada participante da equipe relacionada. Como a gestão quer revisar situações em que o relato mencione apenas parte da equipe?
- Há um CSV histórico de feedback anonimizado com os códigos necessários para relacionar cada registro à entrega correspondente?

### 6. Acessos e responsabilidades

- Quais pessoas ou funções poderão lançar, consultar, corrigir, cancelar, exportar e administrar cadastros?
- Gestores e Diretoria precisam de acesso global ou limitado a lojas/setores específicos?
- Quem aprovará novos usuários, alterações de perfil e escopo, e desligamentos de acesso?
- O painel atual de permissões, que permite consultar a matriz mas não editá-la, atende ao processo desejado?
- O perfil OPERADOR pode manter lojas, pessoas e motivos, mas não acessa indicadores, auditoria nem usuários e acessos. Essa separação atende ao setor de Suporte?

### 7. Apresentação e aceitação

- O fluxo apresentado corresponde ao processo real da equipe? Em que ponto a tela ou o vocabulário divergem?
- Quais três ajustes teriam maior impacto antes do piloto?
- Quem deve aprovar o fluxo funcional e os indicadores antes de usar dados reais?
- Qual data e quais condições devem orientar a decisão de iniciar o piloto?

## Encaminhamentos com Infra

Estes pontos podem ser encaminhados pelo Diretor ao responsável técnico, sem compartilhar senhas ou chaves na reunião:

- domínio oficial do Portal e subdomínio HTTPS da API;
- conta AWS, região, EC2/VPC e grupos de segurança autorizados;
- catálogo RDS de staging, responsável pelas credenciais de runtime e responsável por migrations;
- projeto e equipe Vercel, com ambientes Preview e Production separados;
- política para acesso ao Preview e origens que a API aceitará;
- pessoa responsável por DNS/TLS, logs, monitoramento, backup e restauração.

## Saídas para registrar ao final

- [ ] Escopo e lojas/equipes do piloto definidos.
- [ ] Grão do lançamento e regras de correção/cancelamento aprovados.
- [x] Regra do OTIF e agregações por motorista, equipe e loja definidas.
- [x] Meta e faixas de cor do OTIF adiadas para depois do piloto.
- [ ] Apresentação do ranking misto validada pela gestão; avaliar volume mínimo ou desempate depois de observar os dados.
- [ ] Acesso, retenção e tratamento do feedback definidos.
- [ ] Responsáveis e prazo para listas oficiais e CSVs anonimizados identificados.
- [ ] Responsável de negócio e responsável de Infra nomeados para os próximos passos.
