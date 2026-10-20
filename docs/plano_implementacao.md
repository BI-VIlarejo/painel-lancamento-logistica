# Plano de implementação do portal de lançamento de dados

**Atualizado em:** 16/10/2026
**Status:** plano de execução; as decisões de negócio e infraestrutura indicadas como pendentes precisam ser aprovadas antes de gravar dados reais ou publicar em produção.

Este documento organiza o trabalho do `LancamentoLogistica` em ordem de implementação. A [especificação do portal](./especificacao_portal_lancamento_logistica.md) continua sendo a referência para campos, regras, arquitetura, segurança e modelo de dados. O [DBML operacional](./modelo_operacional_lancamento_logistica.dbml) é uma proposta, ainda não é uma migration aplicada.

## 1. Objetivo e escopo

Construir um portal independente do VilarejoBI para registrar dados operacionais de Logística, começando pelo módulo de Entregas inspirado no protótipo da ADAPTA. O portal deve autenticar cada pessoa, limitar o acesso por perfil, setor e localidade, persistir lançamentos no banco central e manter histórico auditável. Quem preenche confere e confirma o próprio lançamento; a confirmação o registra imediatamente, sem fila de aprovação por outra pessoa.

O navegador conversa somente com a aplicação HTTPS. A API é responsável por autorizar e validar cada ação e por acessar o banco. Rascunhos e formulários ficam em tabelas operacionais `op_logistica_*`; não devem ser gravados diretamente nas tabelas fato mensais do BI.

### Primeira versão proposta

Até confirmação do gestor, usar como hipótese de planejamento uma primeira entrega focada em:

- navegação básica do portal e área de Entregas;
- lançamento diário agregado por localidade/equipe, sem assumir que `data + localidade + motorista` seja chave única;
- rascunho, edição enquanto permitido, confirmação direta e histórico;
- quantidades realizadas e não realizadas, motivos, participantes e observações;
- autenticação, autorização por ação e escopo de setor/localidade;
- persistência operacional, auditoria e validação no servidor.

Feedbacks com dados de clientes, ranking, painel gerencial, importação CSV e impressão/PDF entram depois de suas regras e permissões serem aprovadas. Gestão de Frota e Operações no CD são módulos posteriores, cada um com campos e tabelas tipadas próprias.

## 2. Sequência resumida

| Ordem | Etapa | Resultado principal | Dependência importante |
|---|---|---|---|
| 0 | Fechar decisões de negócio e acesso | Escopo do MVP, grão, autorização e dados pessoais definidos | Gestor e Infra |
| 1 | Validar arquitetura e conectividade | Caminho aprovado entre aplicação, identidade e RDS/staging | Infra e segurança |
| 2 | Preparar aplicação e repositório | Scaffold de frontend React/Vite e API FastAPI modular, com configuração por ambiente | Etapa 0; pode começar com dados fictícios |
| 3 | Revisar modelo e preparar a migration | DBML, ORM e migration revisados; aplicação do banco adiada | Etapa 0; coordenar a cadeia do VilarejoBI |
| 4 | Implementar autenticação e autorização | Primeiro sessão/identidade; depois permissões e escopos no servidor | Políticas da Etapa 0; modelos prontos; banco para validação ponta a ponta |
| 5 | Entregar fluxo de Entregas | Criar, editar rascunho, confirmar e consultar lançamentos | Etapas 3 e 4 |
| 6 | Completar cadastros e feedback | Gestão de catálogos, correções auditáveis e feedback | Etapas 4 e 5; política de feedback |
| 7 | Entregar indicadores e relatórios | Consultas e exportações limitadas pelo mesmo escopo | Definições de negócio aprovadas |
| 8 | Publicar dados no modelo analítico | Carga idempotente de lançamentos confirmados, sem duplicidade | Dono da métrica e contrato com BI/ETL |
| 9 | Fazer piloto e liberar o MVP | Operação de Entregas acompanhada e aceite dos gestores | Etapas anteriores e release aprovado |
| 10 | Adicionar outros setores | Formulários próprios de Frota, CD e novos setores | MVP aceito; descoberta e aceite de cada setor |

## 3. Etapas de implementação

### Etapa 0 — Fechar as decisões que definem o produto

**Objetivo:** evitar que as tabelas, permissões e telas sejam construídas sobre regras ainda incertas.

**O que fazer:**

1. Confirmar se o MVP terá somente o lançamento e histórico de Entregas ou se precisa reproduzir as cinco abas do protótipo.
2. Confirmar a granularidade: resumo diário por localidade/equipe, rota ou pedido; registrar se pode haver mais de um lançamento para a mesma data e localidade.
3. Definir quem pode criar, confirmar, cancelar e corrigir lançamentos. O fluxo padrão permite que o autor confirme o próprio lançamento; não há aprovação obrigatória por outra pessoa.
4. Aprovar a matriz de perfis e escopos: ações de cada perfil e setores/localidades disponíveis para cada pessoa. Não inferir autorização apenas pelo cargo.
5. O login local por username e senha está decidido. Definir provisionamento/ativação de contas, senha inicial, recuperação, necessidade de MFA, duração da sessão e quem pode conceder perfis/escopos.
6. Decidir se nome do cliente é necessário em feedback, quem pode consultar/exportar esses dados e qual é o prazo de retenção. Feedback só entra no escopo quando isso estiver definido.
7. Aprovar a fórmula, o nome e a meta dos indicadores. Os campos atuais não demonstram pontualidade; sem novos dados e regra, não apresentar a taxa de conclusão como OTIF.
8. Decidir se ranking individual é necessário e qual regra atribui resultados coletivos a cada participante. Sem regra aprovada, mostrar resultados por equipe ou agregados.
9. Definir catálogo/banco operacional, grants de leitura e escrita e forma de sincronizar localidades e pessoas.
10. Confirmar o serviço AWS/VPC que hospedará a API, endpoint HTTPS, Security Groups e secrets para a RDS privada; a Vercel hospeda o frontend estático.
11. Aprovar o que fica fora do MVP (CSV, PDF/impressão, painel, ranking e feedback) e registrar responsáveis pelas decisões.

**Entregáveis:** registro das decisões no contexto mestre do projeto; backlog do MVP; matriz perfil × ação × escopo; diagrama de implantação escolhido.

**Critério para avançar:** grão, fluxo de confirmação/correção, identidade, política de PII, destino das tabelas e caminho de rede estão definidos. O layout e as rotas com fixtures podem avançar enquanto decisões não bloqueantes são fechadas; dados reais, migration final e publicação ficam aguardando as decisões que os afetam.

### Etapa 1 — Validar arquitetura, ambiente e conexão com o banco

**Objetivo:** confirmar cedo onde a aplicação vai executar e como chegará ao banco sem expor a RDS.

**O que fazer:**

1. Manter o portal no repositório privado `LancamentoLogistica`, separado do `VilarejoBI` e do `VilarejoAutomacaoLogistica`; definir responsáveis, branches e revisão de alterações.
2. Registrar as versões de Python e Node.js e as dependências do FastAPI e React/TypeScript/Vite.
3. Provisionar ou identificar desenvolvimento e staging. Preview nunca deve apontar para o banco de produção.
4. Confirmar o acesso local ao staging pelo túnel SSH aprovado via EC2/Tailscale e validar que a API na AWS alcança a RDS pela rede privada.
5. Confirmar região, TLS, Security Groups, pool de conexões, endpoint HTTPS público da API e limite de recursos do serviço escolhido.
6. Separar credenciais de runtime (permissões mínimas de leitura/escrita operacional) das credenciais de migration. Guardar segredos no gerenciador aprovado.
7. Definir quem executa migrations e em qual etapa controlada do release; não executar migration de produção no build da aplicação.

**Entregáveis:** decisão técnica de hospedagem; ambientes identificados; evidência de conectividade com staging; lista de variáveis/segredos por ambiente e responsáveis.

**Critério para avançar:** o fluxo local e o fluxo AWS/VPC estão documentados, staging está isolado de produção, e a API alcança a RDS pela rede autorizada sem expor o banco ao frontend.

### Etapa 2 — Criar a estrutura da aplicação e a navegação base

**Objetivo:** estabelecer o esqueleto e as configurações para que UI, identidade e módulos sejam implementados sobre uma base comum.

**O que fazer:**

1. Criar a estrutura `frontend/` React/TypeScript/Vite para páginas estáticas e `backend/` FastAPI como monólito modular.
2. Criar a estrutura de `api`, `core`, módulos de domínio, cliente HTTP, features, estilos e migrations, documentando a responsabilidade dos arquivos ainda vazios.
3. Preparar Docker Compose para a API e as configurações de build/publicação do frontend na Vercel.
4. Documentar o túnel local via EC2/Tailscale e a conexão privada direta da API na AWS à RDS. Nunca registrar token, senha ou texto integral de feedback em logs.
5. Remover do fluxo novo dependência de `localStorage`, Firebase configurado pelo usuário e dados de demonstração em produção.
6. Criar instruções de execução local e configuração de ambiente sem segredos. O scaffold sozinho ainda não inicia o portal funcional.

**Entregáveis:** estrutura de pastas, arquivos-fonte comentados, configurações locais e guia de desenvolvimento.

**Critério para avançar:** decisões de ambiente e conexão estão registradas e nenhuma credencial SQL é enviada ao frontend. A execução funcional será concluída na etapa de implementação da aplicação.

### Etapa 3 — Revisar o modelo operacional e preparar a migration

**Objetivo:** deixar DBML, ORM e migration prontos para persistência operacional sem aplicar mudanças ao banco nesta fase.

**O que fazer:**

1. Revisar o DBML operacional após as decisões da Etapa 0. Confirmar as entidades necessárias ao MVP e retirar ou adiar tabelas sem uso imediato, sem perder as regras de histórico e autorização.
2. Confirmar códigos estáveis para setor, localidade, pessoa e motivo. Localidade deve vir de catálogo aprovado; não aceitar texto livre como identificador de filial.
3. Revisar os modelos SQLAlchemy do backend do portal contra o DBML; conferir FKs, índices e checks. A migration inicial inclui as tabelas operacionais-base e as tabelas opcionais registradas no modelo.
4. Definir constraints e índices: username normalizado único, campos de credencial consistentes e opcionais até o provisionamento da senha, UUIDs/idempotência, não negatividade, estados válidos, vigência de catálogos e consultas usuais por status/data/localidade/autor. CPF fica fora do MVP até haver necessidade aprovada.
5. Implementar transações para salvar cabeçalho, revisão, participantes, motivos e eventos correspondentes juntos. Mudanças de permissão/escopo e seu registro em `op_logistica_autorizacao_evento` também devem ser atômicos; revogações exigem motivo. Regras entre linhas, como soma de motivos, devem ser validadas no serviço antes de confirmar a transação.
6. Gerar uma migration incremental revisada. Se o catálogo for compartilhado, coordenar a sequência Alembic com o dono do banco; não editar ou reaplicar a baseline analítica de 15 tabelas.
7. Manter a aplicação da migration adiada. Quando houver autorização e uma janela de mudança, aplicá-la primeiro em desenvolvimento/staging e conferir constraints, índices, permissões SQL e restauração a partir do backup.
8. Carregar/sincronizar localidades e catálogos aprovados de forma idempotente somente depois que a conexão e a carga inicial forem autorizadas; manter histórico por desativação/vigência em vez de apagar registros usados.

**Entregáveis:** DBML atualizado; modelos ORM revisados; migration incremental revisada e pronta na cadeia Alembic do VilarejoBI; definição dos catálogos iniciais. A aplicação no banco fica para uma etapa posterior autorizada.

**Critério para avançar:** DBML, ORM e migration estão alinhados e revisados, sem alteração da baseline analítica; nenhuma migration foi aplicada ao banco.

### Etapa 4 — Implementar autenticação e autorização no servidor

**Objetivo:** primeiro identificar com segurança quem está usando a API; em seguida, limitar cada ação aos perfis e escopos concedidos no servidor. Faça a parte 4.1 antes da 4.2. A autenticação não concede acesso a Entregas por si só.

#### 4.1 Autenticação e sessão — primeira parte

**Resultado:** login local, sessão persistente revogável e consulta da identidade autenticada. Não incluir cadastro público nem decidir permissões nesta parte.

**Ordem de implementação:**

1. **Fechar as configurações da sessão.** Definir a duração máxima da sessão e configurá-la, sem deixar número fixo espalhado pelo código. Sugestão inicial para discussão: 12 horas, com expiração absoluta e sem renovação automática. Usar cookie `HttpOnly`; em produção, `Secure`; escolher `SameSite` de acordo com os domínios reais do frontend e da API. Como as rotas usam cookie, definir também a validação de origem e o mecanismo de CSRF para `POST`, `PUT`, `PATCH` e `DELETE`. A configuração de produção não pode depender de segredo padrão ou vazio.
2. **Fechar a política de senha.** Usar Argon2id por meio de `app/core/security.py`; o mínimo para senha nova é 6 caracteres, conforme decidido para o projeto, e o máximo continua limitado para evitar payloads excessivos. A função de hash já aplica esse mínimo; manter a mesma regra quando o fluxo controlado de provisionamento/troca for definido. O endpoint de login não deve revelar se falhou o username ou a senha.
3. **Completar `app/modules/auth/repository.py`.** Criar operações para buscar a conta pelo username canônico, criar uma sessão pelo hash do token, localizar sessão válida junto da conta e revogar a sessão. Atualizar `ultimo_login_em` no mesmo fluxo transacional da criação. O repositório não deve retornar hash de senha em resposta HTTP nem gravar token bruto.
4. **Completar `app/modules/auth/service.py`.** No login, normalizar o username (trim e minúsculas), localizar a conta e só autenticar se ela estiver ativa, tiver hash provisionado e a senha passar na verificação. Para conta inexistente, inativa, sem senha ou senha incorreta, devolver a mesma resposta de autenticação negada. Gerar token opaco com fonte criptográfica segura, persistir somente SHA-256 do token e devolver o token bruto apenas ao router para emissão do cookie. Na validação da sessão, exigir token correspondente, não revogado, não expirado e conta ativa. No logout, revogar a sessão atual.
5. **Completar `app/api/v1/dependencies.py`.** Criar uma dependência `get_current_user` que leia o cookie, calcule o hash do token e peça ao serviço a validação da sessão. Sem sessão válida, responder `401`; se o banco estiver indisponível, preservar o erro `503`. Essa dependência identifica o usuário, mas ainda não calcula permissões.
6. **Completar `app/modules/auth/router.py` e ligar as rotas em `app/api/v1/router.py`.** Implementar:
   - `POST /api/v1/auth/login`: recebe username e senha, cria sessão, define o cookie e devolve o token CSRF;
   - `POST /api/v1/auth/logout`: revoga a sessão e limpa o cookie com os mesmos atributos usados ao criá-lo;
   - `GET /api/v1/auth/csrf`: exige sessão válida e fornece um token CSRF novo após recarregar o frontend;
   - `GET /api/v1/me`: exige sessão válida e retorna apenas os dados públicos de identidade.

   Ajustar `schemas.py` para nunca serializar senha, hash ou token de sessão. A resposta de `/me` nesta parte não deve inventar capacidades: permissões e escopos entram na parte 4.2.
7. **Adicionar proteção para uso por navegador.** Com cookie de sessão, validar o token CSRF enviado em `X-CSRF-Token` nas operações de escrita e conferir a origem permitida. Emitir o token CSRF por mecanismo validado pelo backend, sem expor o cookie de sessão ao JavaScript. Manter CORS limitado às origens configuradas e com credenciais habilitadas. Nunca guardar token de sessão em `localStorage`.
8. **Tratar abuso e logs.** Aplicar limitação de tentativas de login e resposta genérica para credenciais inválidas. Uma limitação em memória serve apenas para desenvolvimento com um processo; antes de produção, usar limite compartilhado entre instâncias ou no gateway. Não registrar senha, hash, cookie, token CSRF ou token de sessão.
9. **Provisionar contas sem cadastro público.** Não criar `POST /register`. A página autenticada de Administração provisiona contas apenas para quem tem `CONTROLE_ACESSO:ADMINISTRAR`, aplica Argon2id, concede um perfil e escopo iniciais na mesma transação e exige troca da senha temporária no primeiro acesso. A administração pode adicionar outros acessos depois. O comando interativo `cd backend && python -m scripts.provision_user` continua disponível para bootstrap operacional; o primeiro acesso de produção deve receber concessão por processo administrativo auditado.

**Arquivos desta parte:**

- Implementados nesta etapa: `backend/app/modules/auth/repository.py`, `service.py`, `router.py`, `schemas.py` e `normalization.py`.
- Provisionamento administrativo interativo: `backend/scripts/provision_user.py`.
- Segurança e configuração da sessão: `backend/app/core/security.py` e `backend/app/core/config.py`.
- Dependência e composição: `backend/app/api/v1/dependencies.py`, `backend/app/api/v1/router.py` e `backend/app/main.py`.
- Modelos existentes: `backend/app/modules/auth/models.py` (`Usuario` e `UsuarioSessao`).

**Critérios de aceite da parte 4.1:**

- Usuário inexistente, conta inativa, conta sem senha provisionada e senha incorreta produzem a mesma resposta pública de login negado.
- A senha nunca é persistida em texto puro; o banco recebe somente hash Argon2id da senha e SHA-256 do token da sessão.
- Token bruto da sessão aparece somente no cookie `HttpOnly`; não aparece no corpo HTTP, banco ou logs.
- Sessão expirada, revogada ou pertencente a uma conta desativada não autentica; logout revoga a sessão e remove o cookie.
- Requisições sem sessão recebem `401`; indisponibilidade do banco continua sendo `503`.
- Operações com cookie rejeitam origem não permitida e token CSRF ausente ou inválido.
- A senha nova respeita o mínimo de 6 caracteres; não há endpoint público de cadastro.
- `GET /api/v1/me` retorna identidade pública e não inclui hash ou capacidades ainda não implementadas.

**Limite desta entrega:** os modelos ORM e as migrations de sessão já estão preparados, mas a migration não deve ser aplicada agora. A lógica pode ser implementada sem conectar a API ao banco; o aceite ponta a ponta com sessão persistida depende da aplicação futura da migration e da configuração da conexão autorizada.

#### 4.2 Autorização — segunda parte

Depois de concluir a parte 4.1:

1. Resolver no servidor as concessões vigentes de usuário, perfil e escopo. Username autentica a conta; papéis, IDs de perfil e escopos enviados pelo navegador nunca provam permissão.
2. Implementar dependências para ações como `VER`, `CRIAR`, `EDITAR_RASCUNHO`, `CANCELAR`, `ADMINISTRAR_CADASTROS` e `EXPORTAR`, conforme a matriz aprovada. Confirmar um lançamento usa a permissão de criação; não exige permissão de aprovador.
3. Aplicar filtros de setor/localidade nas consultas do repositório antes de paginação ou retorno e verificar o escopo do objeto em toda alteração.
4. Completar `GET /api/v1/me` com permissões e escopos calculados pelo servidor para a navegação do frontend.
5. Negar por padrão conta inativa, concessão vencida, ausência da permissão exigida ou registro fora do escopo. Limitar tentativas e registrar eventos sem expor credenciais ou dados sensíveis.

**Implementado no backend:** as concessões vigentes são resolvidas em `access_control`; `/api/v1/me` retorna permissões e escopos calculados pelo servidor; as dependências `require_permission` e `require_global_permission` protegem rotas; `/api/v1/access` administra perfis, recursos, permissões, contas, associações e escopos. A área administrativa lista/provisiona contas, desativa contas encerrando sessões, atribui múltiplos perfis/escopos e lista as opções de setor/localidade. Os cadastros operacionais podem ser criados e desativados sob `CADASTROS:ADMINISTRAR`; pessoas e motivos são versionados por vigência. Alterações e revogações são registradas em `op_logistica_autorizacao_evento` na mesma transação. As leituras de formulários continuam em `/api/v1/setores`, `/localidades`, `/pessoas` e `/motivos`.

As rotas de contas e concessões exigem `CONTROLE_ACESSO:ADMINISTRAR` em escopo `GLOBAL`; os cadastros operacionais exigem `CADASTROS:ADMINISTRAR` global. O bootstrap local cria perfis `DEV`, `DIRETORIA`, `GESTOR` e `OPERADOR`: gestores podem lançar, consultar indicadores e administrar acessos/cadastros; diretoria administra acessos/cadastros e consulta entregas/indicadores; os escopos continuam limitando os dados. O perfil `GESTOR` pode conceder até o próprio nível; `DIRETORIA` pode conceder `OPERADOR`, `GESTOR` e `DIRETORIA`; somente uma conta `DEV` global pode conceder o perfil `DEV`, sempre com escopo global. A alteração das definições de perfis, recursos e permissões fica restrita ao perfil `DEV`. Gestores e diretoria também não podem desativar contas nem revogar concessões de nível superior ao seu. Os endpoints de Entregas exigem `ENTREGAS_DIARIAS:VER`, `ENTREGAS_DIARIAS:CRIAR` ou `ENTREGAS_DIARIAS:EDITAR_RASCUNHO`, conforme a operação. A evolução do CHECK de `tipo_evento` para eventos de contas e catálogos precisa entrar na migration compartilhada da cadeia `logistica` do VilarejoBI; a aplicação da migration continua adiada.

O catálogo de pessoas não possui vínculo de setor/localidade no modelo atual; a consulta exige contexto autorizado, mas retorna a lista ativa compartilhada de pessoas. O catálogo de localidades também não tem relação com setor; concessões por localidade filtram pelos IDs concedidos, enquanto concessões por setor permitem consultar o catálogo ativo. As rotas iniciais de `deliveries` já limitam cada lançamento ao setor e às localidades autorizadas; quando um lançamento contém itens de vários escopos, ele só aparece para quem pode ver todos os itens.

**Entregáveis da Etapa 4:** sessão/identidade autenticada na parte 4.1; política central de autorização, permissões e escopos na parte 4.2.

**Critério para avançar à Etapa 5:** as rotas de Entregas exigem identidade autenticada e cada leitura ou comando também verifica a ação e o escopo do usuário no servidor.

### Etapa 5 — Construir a primeira fatia vertical: Entregas

**Objetivo:** percorrer o ciclo completo de um lançamento diário, da tela até o banco e de volta ao histórico.

**Fatia inicial implementada no backend:** criar rascunho com chave de idempotência, consultar detalhe, listar histórico paginado com filtros, atualizar somente enquanto estiver em `RASCUNHO` e confirmar o rascunho validado no estado final `ENVIADA`. A confirmação é feita pelo autor e inclui o registro imediatamente nos indicadores. A API valida setor/localidade, vigência de pessoas e motivos, motorista/ajudantes e soma dos motivos; grava cabeçalho, revisão, itens, participantes, motivos e eventos na mesma transação. Aprovação por outra pessoa não faz parte do fluxo. Correção após confirmação, cancelamento e publicação continuam pendentes.

**O que fazer:**

1. Consumir as rotas paginadas de leitura de setores, localidades, pessoas e motivos implementadas na Etapa 4.2; validar a integração e os filtros de escopo no formulário de Entregas. A carga/sincronização dos catálogos e a manutenção administrativa continuam nesta etapa.
2. Criar formulário de entrega com data, localidade, motorista obrigatório, até dois ajudantes opcionais, realizadas, não realizadas, motivos com quantidades e observação, conforme o contrato aprovado.
3. Não impor chave única apenas por data/localidade/motorista. Gerar UUID estável de item e aplicar somente a regra de duplicidade definida para o grão aprovado.
4. Criar operação de salvar rascunho e operação de confirmação final pelo próprio autor. Receber chave de idempotência para que retry após timeout não crie lançamento duplicado.
5. Validar no backend campos obrigatórios, data, escopo, estado ativo dos participantes/motivos, quantidades não negativas, total maior que zero e soma dos motivos igual ao total não realizado quando aplicável.
6. Salvar os dados do lançamento, participantes, motivos e evento de auditoria na mesma transação; mostrar erros associados ao campo e preservar o rascunho quando a validação falhar.
7. Implementar histórico paginado e filtros de data, localidade, estado, autor e equipe, sempre limitados pelo escopo do usuário.
8. Permitir edição somente em rascunhos e pelas pessoas autorizadas. Depois da confirmação, manter o registro imutável; correções futuras devem criar nova versão vinculada à anterior, sem sobrescrita silenciosa.

**Entregáveis:** formulário funcional; endpoints de catálogo e Entregas; gravação transacional; histórico e edição permitida; eventos de auditoria.

**Critério para avançar:** o lançamento persiste entre dispositivos, as regras são validadas no servidor, retries não duplicam registros e o histórico respeita o escopo.

### Etapa 6 — Completar correções, cadastros e feedback quando autorizado

**Objetivo:** preservar a confiabilidade do histórico após a confirmação e manter referências confiáveis.

**O que fazer:**

1. Tratar `ENVIADA` como estado final de confirmação para novos lançamentos. Os estados `EM_REVISAO`, `DEVOLVIDA` e `APROVADA` permanecem somente para leitura de registros históricos legados.
2. Definir e implementar correção por nova versão, cancelamento com justificativa e permissões correspondentes. Não criar fila de aprovação para o fluxo diário.
3. Registrar estado anterior/novo, ator, horário e comentário em log append-only. Não apagar histórico confirmado por operação comum.
4. A interface administrativa de lojas, pessoas, motivos e contas está implementada. Revisar o catálogo oficial de lojas e a matriz de perfis/escopos antes do piloto; as alterações de pessoas e motivos preservam versões e vigência.
5. Caso feedback esteja aprovado para o MVP ou versão seguinte, criar cadastro e formulário próprios para elogio/reclamação, participantes, localidade e descrição. Aplicar leitura/exportação e retenção mais restritas aos dados do cliente e do relato.
6. Não habilitar pontuação individual de feedback até a política de uso e visibilidade estar aprovada.

**Entregáveis:** correção e cancelamento auditáveis; manutenção controlada de catálogos; módulo de feedback somente se autorizado.

**Critério para avançar:** correções preservam versões; cancelamentos têm justificativa; dados pessoais ficam visíveis apenas aos perfis autorizados.

### Etapa 7 — Implementar painel, filtros e exportação aprovados

**Objetivo:** apresentar medidas com semântica validada e garantir que relatórios não ampliem o acesso aos dados.

**O que fazer:**

1. Implementar filtros de período/competência, localidade, motivo, pessoa, equipe e situação somente para dimensões presentes e autorizadas.
2. Definir o nome e a fórmula de cada medida junto ao gestor. Com os campos atuais, usar rótulo de taxa de entregas realizadas/conclusão se não houver dados de prazo e atendimento completo por pedido.
3. Paginar consultas e agregar no grão aprovado. Não replicar o volume total da equipe em cada participante para produzir ranking individual.
4. Adicionar ranking e score de feedback apenas se fórmula, desempate, volume mínimo e público autorizado estiverem definidos.
5. Confirmar a necessidade de importação CSV. Se aprovada, validar arquivo inteiro e apresentar prévia de erros antes de persistir qualquer linha.
6. Implementar impressão/PDF e exportação com o mesmo filtro e autorização do painel. Proteger colunas com dados pessoais e registrar exportações quando exigido pela política.

**Entregáveis:** painel e relatórios aprovados; documentação das fórmulas; exportação/impressão (se estiverem no escopo).

**Critério para avançar:** totais conferem com exemplos reconciliados, nomes não induzem interpretação incorreta e consultas/exportações obedecem ao mesmo escopo da tela.

### Etapa 8 — Integrar publicação analítica com VilarejoBI e automação

**Objetivo:** publicar somente lançamentos confirmados e evitar perda, duplicidade ou soma entre fontes diferentes.

**O que fazer:**

1. Para cada métrica, registrar origem oficial (portal, SEAC, Cobli, CTA ou arquivo), processo responsável pela publicação e regra para divergências/substituições.
2. Mapear o grão e os campos do portal às fatos atuais. Quando as tabelas existentes não representarem o dia, equipe, motivo ou participantes, revisar DBML analítico antes de criar extensão/migration.
3. Não misturar a tabela operacional com `fato_entregas_mensais` nem converter feedback em devolução/ocorrência sem regra de negócio explícita.
4. Implementar publicação de revisões confirmadas `ENVIADA` com UUID de execução, `codigo_lancamento`, `codigo_revisao` e UUID de item. Considerar `APROVADA` apenas para registros históricos legados. O reprocessamento da mesma revisão deve ser idempotente.
5. Atualizar a versão atual de uma revisão e registrar a anterior transacionalmente; preservar linhagem, contagens, erros e resultado da carga em `op_logistica_publicacao` e correlacionar com `etl_logistica_execucao` quando o catálogo permitir.
6. Coordenar DBML, models e migrations com BI/automação se compartilharem catálogo ou fatos. Manter uma cadeia Alembic coerente por catálogo.
7. Executar publicação em staging e comparar com fontes e controles aprovados. Rodar portal em paralelo à planilha/ETL pelo período definido com o gestor.

**Entregáveis:** contrato de publicação por métrica; serviço idempotente; rastreabilidade entre operação e fato; reconciliação aprovada em staging.

**Critério para avançar:** somente revisões confirmadas chegam ao modelo analítico, reprocessamentos não duplicam medidas e portal/ETL não contam o mesmo indicador duas vezes.

### Etapa 9 — Preparar piloto, release e operação do MVP

**Objetivo:** liberar a primeira versão de Entregas gradualmente, com recuperação e acompanhamento definidos.

**O que fazer:**

1. Configurar deploy preview e staging no provedor escolhido; validar HTTPS, autenticação, conexão ao banco, logs, região e limites de runtime.
2. Configurar variáveis Development/Preview/Production separadamente. Preview usa banco e credenciais de staging; nenhum segredo vai para HTML, JavaScript público ou repositório.
3. Revisar privilégios dos usuários SQL, backup e restauração, retenção de auditoria, monitoramento e alertas de falha de login, autorização e publicação.
4. Preparar procedimento de release/rollback da aplicação e plano de recuperação/forward-fix para migrations antes de produção.
5. Rodar piloto de Entregas com pessoas e localidades escolhidas, mantendo planilha/processo anterior em paralelo. Reconciliar completude, totais, duplicidade, correções e tempo de operação.
6. Corrigir exceções do piloto e colher aceite explícito dos gestores. Só então tornar o portal o fluxo oficial e retirar a alternativa anterior conforme plano aprovado.
7. Acompanhar os primeiros ciclos, registrar incidentes e revisar acessos e cadastros periodicamente.

**Entregáveis:** release aprovado; lista de pessoas/localidades do piloto; reconciliação; procedimento operacional e aceite para entrada em produção.

**Critério de conclusão:** fluxo funciona para o escopo aprovado, dados estão conciliados, permissões e suporte estão operacionais e o gestor aprovou o início oficial.

### Etapa 10 — Adicionar Gestão de Frota, Operações no CD e outros setores

**Objetivo:** expandir o portal sem transformar todos os setores em um formulário genérico.

**O que fazer para cada setor:**

1. Levantar responsáveis, rotina, usuário lançador, fonte atual e motivo para captura manual.
2. Definir cada campo, tipo, unidade, obrigatoriedade, grão, chave de negócio, vigência, origem e regra de validação.
3. Separar dados que devem vir de integração/ETL daqueles que precisam de lançamento humano; evitar duplicar coleta automática.
4. Definir escopos, workflow, correções, relatórios e destino analítico com o gestor do setor.
5. Atualizar DBML e criar tabelas tipadas e migration incremental somente para os dados aprovados. Não usar tabela EAV nem guardar todos os campos como JSON genérico.
6. Implementar tela, endpoints, autorização, persistência, histórico, reconciliação e documentação do módulo.
7. Executar piloto próprio do setor, aceite do gestor e liberação gradual antes de habilitar o próximo.

**Ordem sugerida:** após o MVP de Entregas ser aceito, priorizar o setor conforme necessidade operacional acordada. Coordenar com a automação existente para que o portal não solicite dados já capturados por SEAC, Cobli, CTA ou planilhas automatizadas.

**Entregáveis e critério de saída:** um módulo tipado, autorizado, conciliado e aceito pelo gestor do setor antes de habilitar o setor seguinte.

## 4. Trabalho que pode acontecer em paralelo

Enquanto as decisões de negócio e conectividade são fechadas, podem avançar com fixtures fictícias:

- estrutura frontend React/TypeScript e backend FastAPI modular;
- desenho de formulários sem persistência real;
- schemas e regras de validação isoladas;
- revisão de acessibilidade e mensagens de erro;
- definição de provisionamento de contas, localidades e pessoas.

Dependem de decisões ou do ambiente aprovado: migration definitiva, acesso a dados reais, feedback com dados de cliente, painel/ranking com fórmula oficial, publicação nas fatos analíticas e deploy com conexão à RDS. Automação de planilhas, portal e VilarejoBI mantêm repositórios separados e coordenam contratos, grãos, localidades e propriedade de cada métrica.

## 5. Lista de aceite do MVP de Entregas

- [ ] O escopo do MVP e o grão do lançamento foram aprovados.
- [ ] Login local verifica hash Argon2id, aplica limitação de tentativas e cria sessão segura; todas as consultas e comandos verificam estado da conta, ação e escopo no servidor.
- [ ] Um lançamento válido pode ser salvo, retomado, confirmado pelo autor e encontrado no histórico em outro dispositivo; a confirmação o inclui imediatamente nos indicadores.
- [ ] Quantidades e soma dos motivos são validadas pela API, dentro de transação.
- [ ] Retry de criação/confirmação não cria duplicata.
- [ ] Rascunhos podem ser editados; correções e cancelamentos após confirmação seguem as permissões definidas e deixam versão/evento auditável. Não há aprovação por segundo usuário.
- [ ] O banco operacional não altera a baseline analítica e credenciais de runtime têm privilégio mínimo.
- [ ] Dados pessoais e exports seguem política aprovada; se a política não estiver pronta, feedback não está habilitado.
- [ ] Indicadores têm fórmula e rótulo aprovados; taxa de conclusão não é chamada de OTIF sem dados de prazo.
- [ ] Configuração de preview/staging está separada de produção e RDS não é exposta ao navegador.
- [ ] O piloto foi conciliado com o processo atual e aceito pelo gestor antes da adoção oficial.

## 6. Referências do projeto

- [Especificação detalhada do portal](./especificacao_portal_lancamento_logistica.md)
- [Modelo operacional proposto (DBML)](./modelo_operacional_lancamento_logistica.dbml)
- [Contexto mestre do projeto de Logística](../../docs/contexto_projeto_logistica.md)
- [Documentação geral de Logística](../../docs/README.md)
