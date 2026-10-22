# Pendências para retomada — Portal de Logística

**Atualizado:** 22/10/2026
**Objetivo:** registrar o escopo e o trabalho restante para continuar amanhã sem depender das decisões antigas deste arquivo.

## Escopo confirmado

- O primeiro módulo operacional é **Entregas** e o setor responsável por registrar esses lançamentos é **Suporte**. Feedback, painel e ranking continuam no escopo do lançamento já aprovado.
- No formulário, a pessoa não escolhe um setor. A API associa novos lançamentos ao setor fixo `SUPORTE`.
- O modelo deve continuar preparado para os próximos setores. Quando entrarem no Portal, cada área lançará e consultará seus próprios registros no respectivo setor, respeitando permissões e escopos.
- Não haverá integração com o BI nesta etapa. O Portal manterá seu próprio cadastro de lojas/filiais.
- A migration de localidades `b817e6c2a904` foi aplicada em staging em 22/10/2026; `alembic --name logistica current` confirmou essa revisão como `head`.

### Separação de cadastros e controle de acesso

- [x] Separar `CADASTROS:ADMINISTRAR` de `CONTROLE_ACESSO:ADMINISTRAR` na interface e na API. Quem tem apenas a primeira permissão mantém lojas, equipe e motivos, sem ver a aba de usuários e acessos nem consultar suas rotas.
- [x] Criar o perfil `CADASTRADOR`, que exige concessão global e pode manter catálogos e consultar/exportar feedback. Não recebe lançamento de Entregas, indicadores, auditoria nem administração de usuários.
- [x] Incluir `CADASTROS:ADMINISTRAR` no perfil `OPERADOR`, para a equipe de lançamento usar apenas uma concessão de perfil com escopo de Suporte/loja. `CONTROLE_ACESSO:ADMINISTRAR` continua separado.

Os catálogos atuais são compartilhados pelo Portal e não têm vínculo de propriedade com setor. Assim, qualquer pessoa com `CADASTROS:ADMINISTRAR` consegue consultar e manter a lista inteira; no perfil `OPERADOR`, isso não amplia o escopo das entregas ou do feedback, que continuam limitados às concessões desse perfil. `CADASTRADOR` tem escopo global para catálogos e para a consulta/exportação de feedback. Restringir a manutenção de cadastros por setor ou limitar quais lojas cada cadastrador pode ver exige alterar o modelo de dados e as regras de manutenção.

## Pendências atuais

### 2. Cadastrar lojas e filiais sem BI

O CRUD administrativo foi implementado no Portal. A permissão `CADASTROS:ADMINISTRAR` pode ser concedida sem `CONTROLE_ACESSO:ADMINISTRAR`; o perfil `CADASTRADOR` atende quem mantém lojas, equipe e motivos sem administrar contas. A migration `b817e6c2a904` acrescenta cidade e UF ao catálogo compartilhado e amplia a auditoria para alterações de localidade; ela já foi aplicada em staging. O catálogo operacional de localidades ainda está vazio.

- [x] Adicionar cidade e UF ao cadastro de lojas/filiais; são obrigatórias em cadastros, edições e reativações.
- [x] Criar API e interface administrativa para cadastrar, editar, ativar e desativar lojas.
- [x] Validar campos obrigatórios, formato de código/UF e duplicidade de código ou combinação nome/cidade/UF.
- [x] Manter o catálogo independente do BI.
- [x] Aplicar e confirmar `b817e6c2a904` em staging antes de publicar o backend.
- [x] Versionar a migration no repositório VilarejoBI, dono da cadeia Alembic; commit `fc9a302` contém somente esse arquivo.
- [ ] Carregar e validar a lista real de lojas e filiais quando a fonte oficial e seus responsáveis forem confirmados.

Referências: `backend/app/modules/catalogs/models.py` (modelo Localidade), `backend/app/modules/catalogs/router.py` (API administrativa) e `frontend/src/features/administration/pages/RegistriesPage.tsx` (interface).

### 3. Associar lançamentos de Entregas ao setor Suporte

O setor operacional é resolvido pelo código fixo `SUPORTE`. O banco continua guardando `id_setor` para histórico e escopo. Lançamentos existentes em `ENTREGAS` permanecem com seu setor original; esta mudança não os reatribui.

- [x] Remover a escolha e o envio de setor do formulário, do payload de criação e do importador de Entregas.
- [x] Fazer a API resolver o setor ativo `SUPORTE` e associá-lo ao novo lançamento e às importações.
- [x] Preservar os vínculos e dados já gravados; não remover Setor do modelo nem do controle de escopo.
- [x] Manter a separação por setor para que módulos futuros registrem dados em seus próprios setores.
- [ ] Provisionar `SUPORTE` e a versão do formulário em staging; conceder o novo escopo às pessoas autorizadas. Concessões antigas para `ENTREGAS` não são transferidas automaticamente.

Referência: `backend/app/modules/deliveries/schemas.py`.

### 4. Alinhar feedback e importar seu CSV

O formulário, o payload e a API incluem o nome do cliente conforme a decisão de produto registrada em 21/10. Não se coletam telefone, documento ou outros identificadores. A importação liga cada manifestação a uma entrega confirmada, valida os vínculos no servidor e grava o lote inteiro em uma transação. Nenhum CSV de origem foi encontrado no projeto; o modelo e o mapeamento ainda precisam ser confrontados com uma amostra anonimizada.

- [x] Incluir `nome_cliente` obrigatório no formulário, contrato da API e exportação, sem coletar outros identificadores do cliente.
- [x] Implementar importação com prévia local e no servidor, validação de vínculo e relatório de erros por linha, com gravação transacional do lote.
- [x] Alinhar formulário e importação à decisão de incluir o nome do cliente; a prévia oculta nome e relato e não envia esses campos à validação remota.
- [x] Todos os perfis do piloto podem consultar e exportar feedback dentro dos escopos concedidos. OPERADOR também pode registrar e importar; CADASTRADOR pode manter catálogos e consultar/exportar feedback, mas não registrar nem administrar contas. A importação usa `FEEDBACK_CLIENTES:CRIAR`; exportação usa `FEEDBACK_CLIENTES:EXPORTAR`.
- [ ] Definir a retenção antes de usar dados reais: por quanto tempo nome do cliente e relato ficam guardados e se, ao final, serão apagados ou anonimizados. Hoje não há expurgo automático. Isso não impede o staging com dados fictícios/anonimizados.
- [x] Conferir que logs e mensagens de validação não registrem nem repitam relatos ou dados de clientes; a prévia não mostra nome nem relato.

Modelo implementado: `data_feedback;tipo;nome_cliente;codigo_lancamento;codigo_revisao;codigo_item_lancamento;relato` (também aceita `cliente` como cabeçalho). A API exige permissão de criação para prévia/importação e separa as permissões de consulta e exportação. Todos os perfis ativos do piloto recebem consulta e exportação; os escopos de setor/localidade continuam limitando os dados disponíveis. A retenção de dados reais segue pendente.

Referências: `backend/app/modules/feedback/schemas.py` e `frontend/src/features/feedback/pages/FeedbackPage.tsx`.

### 5. Validar os CSVs reais

O importador de Entregas aceita até 100 linhas como rascunho e agora identifica linha e campo nos erros de conteúdo. O importador de feedback exige códigos estáveis de lançamento, revisão e item para associar cada manifestação. Ainda falta confrontar os dois formatos com arquivos reais anonimizados.

- [ ] Validar os nomes e formatos das colunas do histórico de Entregas.
- [ ] Conferir como os motivos e as observações são interpretados e associados aos cadastros.
- [ ] Validar o CSV de feedback/clientes com uma amostra anonimizada e fechar o mapeamento de colunas e o vínculo das linhas históricas às entregas confirmadas.
- [x] Ajustar as mensagens da prévia para mostrar o arquivo selecionado, a linha e o campo com problema.
- [ ] Usar cópias anonimizadas; não carregar dados reais de cliente em ambiente local.

### 6. Confirmar as regras do painel

Regra confirmada em 22/10/2026: `OTIF = entregas não realizadas / (realizadas + não realizadas)`. O indicador é agregado pelas quantidades do recorte e aparece no geral e por motorista, equipe e loja. O formulário/importador não coletam prazo ou completude; registros antigos também podem ser calculados.

- [x] Fórmula e denominador do OTIF confirmados.
- [x] Agregação de OTIF por motorista, equipe e loja definida.
- [x] Incluir motoristas e ajudantes no mesmo ranking; o score de atendimento entra na classificação.
- [x] Exibir posição, pessoa/função, realizadas, não realizadas, OTIF percentual com barra, elogios, reclamações, score e status ativo/inativo.
- [x] Manter a ordenação implementada: taxa de realização, score de atendimento, volume realizado e nome.
- [x] Identificar que os volumes são resultados coletivos das equipes em que cada pessoa participou e não podem ser somados entre pessoas.
- [ ] Confirmar metas e faixas de cor do OTIF; decisão adiada e fora do bloqueio do primeiro piloto.

### 7. Carregar cadastros reais de staging

O provisionamento DEV prepara perfis, o setor Suporte e o formulário, mas não cadastra as lojas, pessoas e motivos reais. Em 22/10/2026, uma checagem somente de leitura confirmou conexão ao catálogo de staging e presença das tabelas necessárias; nenhuma alteração foi feita nessa checagem. A migration está em `head`; as tabelas de catálogo permanecem sem carga oficial. A conta DEV e a criação de Suporte/formulário seguem pendentes até definir a conta a provisionar. Não usar o BI como fonte automática.

- [x] Aplicar a migration `b817e6c2a904` em staging e confirmar `b817e6c2a904 (head)`.
- [x] Confirmar conexão de staging e presença das tabelas necessárias para provisionamento (checagem somente de leitura, 22/10/2026).
- [ ] Provisionar setor/formulário e conta DEV global com `python -m scripts.provision_staging_dev`; exige username e nome completo da conta a criar/completar.
- [ ] Preparar a carga inicial das lojas/filiais com cidade e UF a partir da lista oficial aprovada.
- [ ] Carregar pessoas operacionais e motivos reais após confirmar os cadastros e responsáveis.
- [ ] Validar os registros carregados antes de liberar contas de usuários finais.
- [ ] Não usar o BI como fonte automática nesta etapa.

### 8. Validar permissões e acessibilidade

- [ ] Percorrer as ações de cada perfil e escopo e confirmar que a API bloqueia operações não autorizadas.
- [x] Registrar permissões padrão: DEV global recebe todas as permissões ativas; GESTOR e DIRETORIA recebem as permissões de gestão; OPERADOR mantém catálogos, lança Entregas e registra/importa/consulta/exporta feedback dentro dos escopos; CADASTRADOR mantém catálogos e consulta/exporta feedback.
- [x] Os perfis existentes atendem ao piloto; OPERADOR não acessa indicadores, auditoria nem usuários e acessos. CADASTRADOR também não administra usuários.
- [x] A matriz de permissões não precisa ser editável pela interface para o piloto.
- [x] Consulta e exportação de feedback estão disponíveis a todos os perfis do piloto, respeitando os escopos concedidos.
- [ ] Revisar navegação por teclado, foco, rótulos, contraste, mensagens de erro e layout em celular.

### 9. Validar tecnicamente e preparar a operação

Os clientes do frontend já chamam as rotas correspondentes da API, e o `compose.yaml` descreve o fluxo local com frontend, backend e MySQL isolado. Ainda falta validar esse fluxo integrado antes de usar staging. Há testes de backend e um workflow de CI no repositório, mas ainda precisam ser executados; não foram encontrados testes de frontend.

- [ ] Executar os testes existentes e corrigir falhas.
- [ ] Validar API, transações e migrations contra um MySQL local isolado.
- [ ] Revisar os arquivos alterados antes de versionar.
- [ ] Medir o tempo do painel com volume representativo de dados; as agregações principais já usam SQL.
- [x] Definir a EC2 como hospedagem da API e `vilarejo_bi_logistica_staging` como banco de staging; seguir o padrão de conectividade do VilarejoBI.
- [x] Preparar Compose de staging no padrão EC2 do VilarejoBI: Nginx na porta 8080, API interna, health check e modelo de variáveis em `deploy/ec2/`.
- [x] Preparar publicação manual da imagem no GHCR e deploy da API por GitHub Actions, com execução restrita à branch `staging`.
- [x] Implementar túnel SSH opcional para a API executada localmente, com destino da EC2 pela rede Tailscale; o runtime da EC2 mantém conexão direta à RDS.
- [ ] Aplicar na EC2 aprovada: confirmar região/instância, domínios, ALB/proxy e target group, Security Groups, papel IAM, método de deploy, segredo de sessão e URL/credencial operacional para conexão privada à RDS.
- [ ] Configurar segredos, CORS, cookies seguros, logs, monitoramento, backup e teste de restauração.
- [ ] Validar login, Entregas, feedback, painel e auditoria com perfis e escopos diferentes.

## Implementado nesta retomada

- [x] Adicionar scroll vertical discreto e estilizado à navegação lateral, mantendo os blocos de ajuda e usuário visíveis.
- [x] Implementar cadastro administrativo próprio de lojas e filiais, com cidade, UF, edição, ativação/desativação e validação de duplicidades; a migration correspondente já foi aplicada em staging.
- [x] Associar automaticamente novos lançamentos e importações de Entregas ao setor `SUPORTE`; lançamentos antigos em `ENTREGAS` mantêm seus vínculos históricos.
- [x] Incluir nome do cliente conforme a decisão de produto e adicionar importação de feedback em lote com modelo CSV, prévia, validação de vínculos e erros por linha; a conferência com o arquivo histórico real continua pendente.

## Para retomar amanhã

1. Abrir a aplicação localmente em modo demonstração ou subir uma instância Compose isolada com a conta `dev-gabriel` (instruções em [rodar-localmente.md](./rodar-localmente.md)).
2. [x] Corrigir o balão informativo no histórico; o espaçamento foi ajustado nesta retomada.
3. [x] Implementar gráficos no Painel Gerencial; o painel já contém gráfico de evolução e barras de composição.
4. Validar o projeto com o Vyctor e levantar se ele pede alguma mudança.
5. Carregar em staging o cadastro real de lojas/filiais depois de receber a lista oficial com código, nome, cidade e UF e confirmar seus responsáveis. A migration `b817e6c2a904` já está aplicada; as tabelas de catálogo estão vazias.
6. Validar com uma amostra anonimizada o formato do histórico de Entregas e ajustar o mapeamento se necessário.
7. Validar com uma amostra anonimizada o modelo de feedback (`data_feedback`, `tipo`, `nome_cliente`, códigos do lançamento/revisão/item e `relato`); o export histórico atual não tem os códigos necessários para reimportação.
8. Definir retenção de nome/relato antes de usar feedback real; metas/faixas do OTIF ficam para depois do piloto.
9. Preparar carga real de staging e seguir com validação técnica e operacional.

## Observação sobre a conta DEV local

O bootstrap foi executado, mas respondeu **“Permissões locais do perfil DEV atualizadas; nenhuma conta foi alterada.”** Isso significa que já havia uma conta DEV global no banco local: o comando não criou `dev-gabriel` nem redefiniu a senha existente. As instruções para criar uma conta DEV nova em um volume local separado estão no [guia para rodar localmente](./rodar-localmente.md).
