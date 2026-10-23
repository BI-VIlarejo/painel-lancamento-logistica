# Pendências para retomada — Portal de Logística

**Atualizado:** 23/10/2026
**Objetivo:** concluir primeiro um staging funcional para o Diretor de Logística; produção é uma etapa separada e ainda não está liberada.

## Escopo confirmado

- O primeiro módulo operacional é **Entregas** e o setor responsável por registrar esses lançamentos é **Suporte**. Feedback, painel e ranking continuam no escopo do lançamento já aprovado.
- No formulário, a pessoa não escolhe um setor. A API associa novos lançamentos ao setor fixo `SUPORTE`.
- O modelo deve continuar preparado para os próximos setores. Quando entrarem no Portal, cada área lançará e consultará seus próprios registros no respectivo setor, respeitando permissões e escopos.
- Não haverá integração com o BI nesta etapa. O Portal manterá seu próprio cadastro de lojas/filiais.
- A migration de localidades `b817e6c2a904` foi aplicada em staging em 22/10/2026; `alembic --name logistica current` confirmou essa revisão como `head`.

## Estado atual — 23/10/2026

- [x] O projeto Vercel foi criado e a prévia visual chegou a `Ready`. Ela usa `VITE_DEMO_MODE=true`, portanto ainda funciona com dados de demonstração e não chama a API.
- [x] A correção visual de Reclamações e Elogios foi publicada em `staging` no commit `2258144`; a correção deixa claro que motorista e ajudantes dependem de uma entrega confirmada para a data e loja escolhidas.
- [x] O usuário criou `${EC2_DEPLOY_DIR}/.env` na pasta `~/dev/Vilarejo-Logistica-Lancamento`. No workflow seguinte, o Compose encontrou o arquivo, baixou a imagem e o backend passou o health check.
- [x] O workflow da API falhou ao iniciar o Nginx porque a porta `8080` já é usada pelo Nginx do VilarejoBI na mesma EC2.
- [x] A Logística foi movida para a porta `8081`; Compose e documentação foram publicados em `origin/staging` no commit `2470aff`.
- [ ] O deploy com a porta `8081` ainda precisa ser executado e confirmado. O último log conhecido terminou com erro, então a API ainda não está confirmada como implantada por completo.
- [ ] A prévia Vercel precisa ser conferida novamente depois dos commits `2258144` e `2470aff`.
- [ ] A URL HTTPS pública da API, o ALB/proxy, DNS, certificado e regras de rede para a porta `8081` ainda precisam ser confirmados com a Infra.

## Ordem para terminar o primeiro staging funcional

1. [ ] Em **GitHub → Actions → Deploy Portal API to Staging → Run workflow**, escolher `staging` depois de confirmar que o branch inclui o commit `2470aff`. Conferir que o secret `EC2_DEPLOY_DIR` é `/home/ubuntu/dev/Vilarejo-Logistica-Lancamento` e que `.env` está ao lado do `compose.yaml`.
2. [ ] Na EC2, conferir que `backend` e `nginx` estão ativos e saudáveis. A Logística deve publicar `8081:80`; não parar nem alterar o Nginx do BI na porta `8080`.
3. [ ] Validar a conexão da API com a RDS, sem gravar dados:

   ```bash
   docker compose --project-name logistica-staging -f compose.yaml exec -T backend python -m scripts.check_staging_db
   ```

   A checagem do endpoint `/health` confirma que a API inicia, mas não substitui esse teste de banco.

4. [ ] Com a Infra, configurar o ALB/proxy HTTPS e o DNS `api-staging`, encaminhando para EC2:8081. Permitir TCP `8081` na EC2 somente a partir do Security Group do ALB/proxy; manter `8000` interno e a RDS privada.
5. [ ] Confirmar a revisão Alembic `b817e6c2a904` e as tabelas necessárias no catálogo `vilarejo_bi_logistica_staging`. Ela foi registrada como `head` e checada anteriormente; revalidar a conexão usando a credencial de runtime agora instalada na EC2. Não executar bootstrap local nem migrations automaticamente pelo container.
6. [ ] Definir os domínios de staging do frontend e da API. Para login/cookies, preferir domínios próprios no mesmo domínio registrável, por exemplo `portal-staging.empresa.com` e `api-staging.empresa.com`.
7. [ ] Na Vercel, conferir a prévia da branch `staging` e adicionar, somente no ambiente **Preview**, `VITE_API_BASE_URL=https://<dominio-api-staging>/api/v1` e `VITE_DEMO_MODE=false`. Fazer um novo deploy da Vercel após salvar as variáveis.
8. [ ] Na EC2, atualizar `CORS_ALLOWED_ORIGINS` no `.env` para a origem HTTPS exata do frontend, sem caminho nem barra final. Depois, executar novamente o workflow da API para aplicar o CORS atualizado.
9. [ ] Com API e RDS validadas, provisionar a conta DEV de staging pelo procedimento de [`provisionar-staging.md`](./provisionar-staging.md), usando somente o banco de staging e entregando a senha temporária por canal privado.
10. [ ] Cadastrar dados de demonstração identificados como fictícios ou carregar cadastros oficiais aprovados de lojas, motoristas/ajudantes e motivos. Configurar usuários e escopos autorizados para `SUPORTE`.
11. [ ] Validar no navegador, com a prévia conectada à API: login/sessão, criação e confirmação de Entrega, registro de Reclamação/Elogio ligado à equipe correta, painel, exportação/importação permitidas, permissões/escopos e auditoria. Conferir também o formulário de ajudantes corrigido no commit `2258144`.
12. [ ] Antes do piloto com dados reais, fechar retenção de nome/relato de cliente, validar CSVs com amostras anonimizadas, confirmar backup/restauração e monitoramento/logs com a Infra.

## Produção — etapa posterior

- [ ] Não promover a prévia atual para produção. Ela é uma demonstração até API, domínio, banco e dados de produção estarem configurados.
- [ ] Após validar staging, integrar o frontend de `staging` em `main` por PR; a `main` atual ainda não contém o frontend.
- [ ] Definir infraestrutura, domínio HTTPS, banco/catálogo, secrets e processo de deploy próprios de produção; o workflow existente publica apenas em staging.
- [ ] Aplicar migrations de produção de forma controlada e repetir as validações funcionais e de segurança antes de liberar dados reais.

O registro do BI que trata da baseline analítica é de outro escopo. Para o Portal, não reaplicar a migration `b817e6c2a904` nem executar migration automaticamente no início do container.

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
- [x] Preparar Compose de staging com API interna e Nginx na porta 8081 (a porta 8080 já está ocupada pelo BI), health check e modelo de variáveis em `deploy/ec2/`.
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

## Plano completo para retomar amanhã

**Objetivo:** concluir a preparação do primeiro staging funcional para o Diretor de Logística testar. A publicação visual isolada na Vercel é a alternativa se a API ou a rede da AWS ainda não estiverem prontas. Staging não é produção.

### A. Conferir o repositório e iniciar o inventário AWS — primeiro passo

- [ ] Abrir o GitHub Actions e confirmar se a CI do último commit em `staging` passou. Resolver qualquer falha antes do workflow de deploy.
- [ ] Entrar no Console AWS, selecionar `us-east-1` (região indicada pelo endpoint RDS já usado no projeto) e confirmar que é a conta AWS esperada.
- [ ] Em **EC2 → Instances**, localizar a instância indicada por `EC2_HOST` no `.env` local. Confirmar que ela está aprovada para hospedar o Portal; não presumir que uma EC2 usada pelo BI pode ser reutilizada sem validação da Infra.
- [ ] Registrar para a instância: nome/ID, estado, VPC, subnet, IP privado, Security Groups anexados, IAM Role, versão/estado de Docker e Compose, usuário de deploy e diretório de deploy disponível.
- [ ] Em **RDS → Databases**, localizar a instância `vilarejo-bi` e conferir endpoint, porta `3306`, VPC, subnet group, Security Groups e **Publicly accessible = No**.
- [ ] Confirmar que o endpoint usado pela aplicação aponta para o catálogo `vilarejo_bi_logistica_staging`. O estado registrado do Portal é `b817e6c2a904 (head)`; não executar upgrade nem bootstrap Alembic de novo.
- [ ] Em **EC2 → Load Balancers** (ou junto à Infra, se o tráfego passar por proxy corporativo), identificar se já existe um ALB/proxy aprovado para a API. Registrar DNS/domínio, esquema público/interno, listener HTTPS `443`, certificado, target group, porta de destino e health check.
- [ ] Registrar os resultados sem incluir senhas, chaves privadas, tokens ou valores secretos. Modelo para preencher:

  ```text
  Conta/região AWS:
  EC2: ID / estado / VPC / subnet / IP privado / Security Groups / IAM Role / Docker-Compose / usuário e diretório de deploy:
  RDS: instância / endpoint (mascarado neste documento) / porta / VPC / subnet group / acesso público? / Security Group:
  Banco do Portal: vilarejo_bi_logistica_staging / revisão Alembic observada:
  ALB/proxy: existe? / domínio / listener HTTPS e certificado / target group / porta / health check:
  ```

Os nomes/endpoints já existentes no `.env` local servem como pistas para localizar os recursos, não como confirmação de que estão aprovados para o Portal. Não copiar o conteúdo do `.env` para o Git ou para este arquivo. O IP Tailscale `100.64.0.2` é endereço de acesso privado de desenvolvimento; não é o domínio HTTPS público da API.

### B. Aprovar e preparar o caminho de rede

- [ ] Confirmar com a Infra o domínio público da API, o DNS, quem termina TLS (ALB ou proxy corporativo) e o certificado HTTPS. O navegador na Vercel precisa alcançar a API por HTTPS.
- [ ] Configurar o target group para enviar tráfego do listener HTTPS ao Nginx da EC2 na porta `8081`, com health check aprovado (o guia usa `/health`).
- [ ] No Security Group da EC2, permitir TCP `8081` somente a partir do Security Group do ALB/proxy. Não abrir a porta `8000`.
- [ ] No Security Group da RDS, permitir TCP `3306` com origem no Security Group da EC2. Manter a RDS privada; não liberar `3306` para a internet nem usar allowlist de IP público como substituto da regra entre Security Groups.
- [ ] Aprovar o acesso SSH `22` somente pelo método administrativo/deploy autorizado. O workflow abre temporariamente a porta `22` para o runner do GitHub e remove a regra que ele criou ao final.
- [ ] Confirmar a rota de saída da EC2 para GHCR e Docker Hub, necessária para baixar a imagem do backend e `nginx:alpine`.
- [ ] Confirmar o IAM Role da EC2 e os privilégios mínimos necessários. Não instalar access keys pessoais na instância.
- [ ] Instalar/validar Docker Engine e Docker Compose; confirmar que o usuário de deploy pode executar Docker e escrever no diretório definido, sem `sudo` interativo.

### C. Preparar credenciais privadas e secrets

- [ ] Criar ou confirmar um usuário de runtime exclusivo para o Portal no catálogo de staging, com privilégio mínimo. Não usar a credencial de migration do BI como credencial da aplicação.
- [ ] Na EC2, criar `.env` no diretório `EC2_DEPLOY_DIR`, ao lado do `compose.yaml`, com proprietário do usuário de deploy e modo `0600`, usando `deploy/ec2/api.env.example` como modelo. Preencher `APP_ENV=staging`, `USE_DB_TUNNEL=false`, a URL privada da RDS com senha codificada em URL, origem exata da Vercel em `CORS_ALLOWED_ORIGINS`, sessão segura e o segredo gerado no host com `openssl rand -hex 32`.
- [ ] Usar `SESSION_COOKIE_SECURE=true` e `SESSION_COOKIE_SAMESITE=lax`. Para evitar bloqueio de cookies, preferir domínio próprio do frontend e da API sob o mesmo domínio registrável, conforme `deploy/ec2/README.md`.
- [ ] Não colocar credenciais em `VITE_*`, no bundle do frontend, no repositório ou no histórico do terminal. `VITE_API_BASE_URL` é pública e pode conter somente a URL da API.
- [ ] Em **GitHub → Settings → Environments → staging**, configurar os secrets exigidos pelo workflow: `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `EC2_SECURITY_GROUP_ID`, `EC2_HOST`, `EC2_USER`, `EC2_PRIVATE_KEY`, `EC2_HOST_FINGERPRINT` e `EC2_DEPLOY_DIR`.
- [ ] Restringir a credencial AWS do Actions a autorizar/remover ingress TCP `22` apenas no Security Group de staging. Conferir o fingerprint SSH por canal confiável. `GITHUB_TOKEN` é fornecido pelo Actions e não deve ser cadastrado manualmente.

### D. Fazer deploy da API

- [ ] Confirmar que a instância e o serviço têm `${EC2_DEPLOY_DIR}/.env` pronto e que o caminho de rede à RDS está liberado antes de publicar.
- [ ] Em **Actions → Deploy Portal API to Staging → Run workflow**, selecionar `staging` e iniciar o deploy manual. O workflow constrói a imagem no GHCR, copia `compose.yaml`/`nginx.conf` e atualiza os containers; ele não aplica migrations.
- [ ] Conferir o resultado de cada etapa do workflow, principalmente publicação da imagem, SSH, cópia dos arquivos, `docker compose pull/up` e remoção da regra temporária de SSH.
- [ ] Validar `https://<domínio-da-api>/health` pelo endpoint HTTPS aprovado.
- [ ] Executar o check de conectividade DB descrito no guia a partir do container do backend (`scripts.check_staging_db`) e confirmar a conexão sem gravar dados. Investigar DNS privado, rota, Security Groups e credencial se falhar; não tornar a RDS pública para contornar falha de rede.

### E. Preparar Vercel e escolher tipo de prévia

- [x] Criar o projeto Vercel ligado ao repositório, configurar `frontend/` como **Root Directory** e publicar uma prévia visual `Ready` na branch `staging`.
- [x] Configurar a prévia visual com `VITE_DEMO_MODE=true`; ela usa dados locais de demonstração e não chama API/banco.
- [ ] Conferir se a prévia gerada após os commits `2258144` e `2470aff` está `Ready` e mostra a correção de alinhamento/equipe.
- [ ] Para uma prévia funcional, configurar `VITE_API_BASE_URL=https://<domínio-da-api>/api/v1` e `VITE_DEMO_MODE=false`. Configurar o domínio próprio do frontend, preferencialmente no mesmo domínio registrável da API.
- [ ] Atualizar `CORS_ALLOWED_ORIGINS` na EC2 com a origem exata do frontend (sem `/*` nem barra final) e publicar novamente a API se essa variável mudar.
- [ ] Fazer o deploy Preview na Vercel e conferir no navegador login, cookie de sessão, CORS e chamadas da API.
- [ ] Se a API/rede ainda não estiverem prontas, disponibilizar somente a prévia visual com `VITE_DEMO_MODE=true`, sem URL de API ou banco. Identificar para o Diretor que essa prévia não persiste dados.

### F. Provisionar acesso e dados de demonstração/piloto

- [ ] Definir o username e o nome completo da primeira conta DEV de staging. Depois de confirmar ambiente, URL e migration, executar interativamente `python -m scripts.provision_staging_dev` no host com acesso privado ao banco, conforme [provisionar-staging.md](./provisionar-staging.md). O script prepara a conta DEV global, setor `SUPORTE` e versão do formulário; não executá-lo apontando para banco local ou produção.
- [ ] Guardar/entregar a senha temporária por canal privado; o script a mostra uma vez se criar a conta. Não colar senha em arquivo, ticket, chat de grupo ou logs.
- [ ] Solicitar a lista oficial aprovada de lojas/filiais com código, nome, cidade e UF, e identificar quem responde pela conferência. A migration está aplicada, mas o catálogo operacional de localidades está vazio.
- [ ] Solicitar lista aprovada de motoristas/ajudantes e motivos de ocorrência. Carregar e revisar cadastros antes de conceder escopos aos usuários finais.
- [ ] Criar/atribuir usuários operacionais e escopos autorizados para `SUPORTE` e localidades. Concessões legadas para `ENTREGAS` não migram automaticamente.
- [ ] Se as listas oficiais ainda não estiverem disponíveis, usar apenas dados sintéticos claramente identificados para demonstração; não apresentar os registros fictícios como dados reais.

### G. Validar fluxo funcional e decidir liberação de dados reais

- [ ] Conferir que a CI passou e executar/confirmar a suíte de testes de backend e a validação integrada documentadas na seção 9. Não há suíte de testes de frontend registrada.
- [ ] Validar com o Diretor o grão implementado: um lançamento por data, localidade e equipe, permitindo várias equipes na mesma loja/data; confirmar que esse resumo diário representa o processo real.
- [ ] Testar login e sessão a partir do domínio da Vercel, expiração/logout, CORS e acesso da API pela HTTPS pública.
- [ ] Testar um ciclo de Entregas: criar rascunho, editar, validar totais e motivos, confirmar, repetir a confirmação sem duplicar, consultar histórico, criar correção/cancelamento com justificativa e conferir auditoria; testar exportação/importação com amostra anonimizada. Confirmar setor `SUPORTE` nos lançamentos novos.
- [ ] Testar Feedback: registrar, pré-visualizar/importar CSV, consultar e exportar, garantindo vínculo com entrega confirmada e erros por linha. O export histórico disponível não tem todos os códigos necessários para reimportar; validar o mapeamento com uma amostra anonimizada antes de prometer migração histórica.
- [ ] Testar Painel e ranking por período, loja, motorista/equipe, realizados/não realizados, OTIF, elogios/reclamações, score e status; conferir que motoristas e ajudantes aparecem juntos e que os totais coletivos não sejam somados entre pessoas.
- [ ] Testar com contas/perfis distintos que OPERADOR pode manter catálogos e lançar dentro do escopo, mas não vê indicadores, auditoria nem usuários e acessos; validar também as permissões de CADASTRADOR, GESTOR, DIRETORIA e DEV.
- [ ] Validar auditoria, exportação, responsividade e principais ações por teclado/foco; conferir que logs não gravem nome do cliente nem relato.
- [ ] Definir retenção e destino do nome do cliente e relato (prazo e apagamento ou anonimização) antes de usar feedback real. Enquanto isso, feedback de demonstração/teste deve ser sintético ou anonimizado.
- [ ] Antes de inserir dados reais, confirmar backup/snapshot, monitoramento/logs e um procedimento de restauração com a Infra.
- [ ] Fazer demonstração ao Diretor, coletar feedback e registrar solicitações novas separadamente do escopo aprovado do primeiro piloto.

### H. Itens adiados ou fora do bloqueio do primeiro deploy

- Metas e faixas de cor do OTIF foram adiadas por decisão do responsável; não bloquear a publicação inicial.
- A integração e a sincronização automática com o BI estão fora deste release; o Portal mantém catálogo próprio.
- O filtro global de setor nas pastas da navegação foi discutido, mas não consta como requisito confirmado para bloquear o primeiro piloto. Reavaliar após feedback do Diretor.
- Outros setores além de `SUPORTE`, expansão de módulos e refinamentos de desempenho com volume de produção ficam para depois do piloto, salvo necessidade identificada na validação.
- O cadastro real de lojas, pessoas, motivos e histórico depende de fontes aprovadas e arquivos anonimizados; não extrair automaticamente do BI.

## Observação sobre a conta DEV local

O bootstrap foi executado, mas respondeu **“Permissões locais do perfil DEV atualizadas; nenhuma conta foi alterada.”** Isso significa que já havia uma conta DEV global no banco local: o comando não criou `dev-gabriel` nem redefiniu a senha existente. As instruções para criar uma conta DEV nova em um volume local separado estão no [guia para rodar localmente](./rodar-localmente.md).
