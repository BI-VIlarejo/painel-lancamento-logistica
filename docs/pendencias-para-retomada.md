# Pendências para retomada — Portal de Logística

**Atualizado:** 21/10/2026  
**Objetivo:** registrar o escopo e o trabalho restante para continuar amanhã sem depender das decisões antigas deste arquivo.

## Escopo confirmado

- O primeiro setor operacional liberado será **Entregas**. Feedback, painel e ranking continuam no escopo do lançamento já aprovado.
- No formulário, a pessoa não escolhe um setor. A API deve associar cada lançamento ao setor fixo **Entregas**.
- O modelo deve continuar preparado para os próximos setores. Quando entrarem no Portal, cada área lançará e consultará seus próprios registros no respectivo setor, respeitando permissões e escopos.
- Não haverá integração com o BI nesta etapa. O Portal manterá seu próprio cadastro de lojas/filiais.
- A revisão compartilhada de staging foi aplicada em 21/10/2026: o comando `alembic --name logistica current` retornou `f3c8a1d6b907 (head)`. Não repetir migration para essa revisão.

## Pendências atuais

### 2. Cadastrar lojas e filiais sem BI

A API lista localidades, mas não oferece cadastro ou importação administrativa. O modelo de Localidade também não tem cidade e UF.

- [ ] Adicionar cidade e UF ao cadastro de lojas/filiais.
- [ ] Criar API e interface administrativa para cadastrar, editar e desativar lojas, ou permitir importar uma planilha/CSV inicial.
- [ ] Definir validações para duplicidades e campos obrigatórios.
- [ ] Manter o catálogo independente do BI.

Referências: `backend/app/modules/catalogs/models.py` (modelo Localidade) e `backend/app/modules/catalogs/router.py` (consulta atual).

### 3. Associar Entregas automaticamente ao setor

O contrato da API ainda exige `id_setor` e o frontend ainda o envia.

- [ ] Remover a escolha e o envio de setor do formulário e dos payloads de Entregas.
- [ ] Fazer a API resolver e associar automaticamente o setor fixo **Entregas**.
- [ ] Preservar os vínculos e dados já gravados; não remover Setor do modelo nem do controle de escopo.
- [ ] Manter a separação por setor para que módulos futuros registrem dados em seus próprios setores.

Referência: `backend/app/modules/deliveries/schemas.py`.

### 4. Alinhar feedback e importar seu CSV

A API exige `nome_cliente`, mas o formulário/payload não o envia. Há exportação e consulta, mas ainda falta a importação do CSV de feedback.

- [ ] Alinhar schema, formulário e payload para o campo de cliente conforme as colunas reais do CSV.
- [ ] Implementar importação com prévia, validação e relatório de erros por linha.
- [ ] Definir quem pode consultar e exportar feedback e por quanto tempo os registros serão mantidos.
- [ ] Conferir que logs e mensagens de erro não exponham descrições ou dados de clientes sem necessidade.

Referências: `backend/app/modules/feedback/schemas.py` e `frontend/src/features/feedback/pages/FeedbackPage.tsx`.

### 5. Validar os CSVs reais

O importador de Entregas aceita até 100 linhas como rascunho, mas ainda precisa ser conferido com arquivos reais anonimizados. A importação de feedback ainda não existe.

- [ ] Validar os nomes e formatos das colunas do histórico de Entregas.
- [ ] Conferir como os motivos e as observações são interpretados e associados aos cadastros.
- [ ] Validar o CSV de feedback/clientes e fechar o mapeamento de suas colunas.
- [ ] Ajustar as mensagens da prévia para apontar arquivo/linha/campo com problema.
- [ ] Usar cópias anonimizadas; não carregar dados reais de cliente em ambiente local.

### 6. Confirmar as regras do painel

OTIF já aparece no formulário, importador, histórico e painel. O cálculo usa o total registrado como denominador e só apresenta o indicador quando todas as Entregas do filtro têm as duas contagens de OTIF. Registros antigos podem não ter essas contagens.

- [ ] Obter aceite para o denominador “total registrado”.
- [ ] Aprovar como exibir filtros que misturam registros novos com registros antigos sem contagens.
- [ ] Aprovar ou alterar os critérios atuais do ranking: taxa de realização, avaliação de feedback e volume.
- [ ] Confirmar se o ranking dentro do painel atende ao lançamento; uma página separada não é necessária se essa apresentação for suficiente.
- [ ] Conferir que volume da equipe não seja descrito como produtividade individual exclusiva.

### 7. Carregar cadastros reais de staging

O provisionamento DEV prepara perfis, o setor Entregas e o formulário, mas não cadastra as lojas, pessoas e motivos reais. A administração de pessoas e motivos já existe; o cadastro independente de lojas ainda precisa ser viabilizado.

- [ ] Definir e preparar a carga inicial das lojas/filiais, incluindo cidade e UF.
- [ ] Carregar pessoas operacionais e motivos reais após confirmar os cadastros e responsáveis.
- [ ] Validar os registros carregados antes de liberar contas de usuários finais.
- [ ] Não usar o BI como fonte automática nesta etapa.

### 8. Validar permissões e acessibilidade

- [ ] Percorrer as ações de cada perfil e escopo e confirmar que a API bloqueia operações não autorizadas.
- [ ] Confirmar a política atual: DEV global recebe todas as permissões ativas; GESTOR e DIRETORIA recebem as permissões padrão.
- [ ] Decidir se é necessário um perfil ADMIN distinto; atualmente não existe perfil ADMIN separado.
- [ ] A tela de administração mostra as permissões do perfil, mas não permite editar a matriz. Decidir se isso basta para o lançamento.
- [ ] Revisar navegação por teclado, foco, rótulos, contraste, mensagens de erro e layout em celular.

### 9. Validar tecnicamente e preparar a operação

Há testes de backend e um workflow de CI no repositório, mas ainda precisam ser executados. Não foram encontrados testes de frontend.

- [ ] Executar os testes existentes e corrigir falhas.
- [ ] Validar API, transações e migrations contra um MySQL local isolado.
- [ ] Revisar os arquivos alterados antes de versionar.
- [ ] Medir o tempo do painel com volume representativo de dados; as agregações principais já usam SQL.
- [ ] Definir hospedagem da API, URL HTTPS e conexão privada à RDS.
- [ ] Configurar segredos, CORS, cookies seguros, logs, monitoramento, backup e teste de restauração.
- [ ] Validar login, Entregas, feedback, painel e auditoria com perfis e escopos diferentes.

## Implementado nesta retomada

- [x] Adicionar scroll vertical discreto e estilizado à navegação lateral, mantendo os blocos de ajuda e usuário visíveis.

## Para retomar amanhã

1. Abrir a aplicação localmente em modo demonstração ou subir uma instância Compose isolada com a conta `dev-gabriel` (instruções em [rodar-localmente.md](./rodar-localmente.md)).
2. Corrigir o balão informativo no histórico: está fora de posição e encostado em uma linha.
3. Implementar gráficos no Painel Gerencial.
4. Validar o projeto com o Vyctor e levantar se ele pede alguma mudança.
5. Implementar o cadastro próprio de lojas/filiais com cidade e UF.
6. Remover `id_setor` da entrada de Entregas e associar o setor Entregas no backend.
7. Alinhar o contrato do feedback e depois implementar a importação do CSV.
8. Validar os CSVs anonimizados e fechar as regras de OTIF/ranking com o responsável.
9. Preparar carga real de staging e seguir com validação técnica e operacional.

## Observação sobre a conta DEV local

O bootstrap foi executado, mas respondeu **“Permissões locais do perfil DEV atualizadas; nenhuma conta foi alterada.”** Isso significa que já havia uma conta DEV global no banco local: o comando não criou `dev-gabriel` nem redefiniu a senha existente. As instruções para criar uma conta DEV nova em um volume local separado estão no [guia para rodar localmente](./rodar-localmente.md).
