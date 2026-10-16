# Plano de implementação do portal de lançamento de dados

**Atualizado em:** 15/10/2026  
**Status:** plano de execução; as decisões de negócio e infraestrutura indicadas como pendentes precisam ser aprovadas antes de gravar dados reais ou publicar em produção.

Este documento organiza o trabalho do `LancamentoLogistica` em ordem de implementação. A [especificação do portal](./especificacao_portal_lancamento_logistica.md) continua sendo a referência para campos, regras, arquitetura, segurança e modelo de dados. O [DBML operacional](./modelo_operacional_lancamento_logistica.dbml) é uma proposta, ainda não é uma migration aplicada.

## 1. Objetivo e escopo

Construir um portal independente do VilarejoBI para registrar dados operacionais de Logística, começando pelo módulo de Entregas inspirado no protótipo da ADAPTA. O portal deve autenticar cada pessoa, limitar o acesso por perfil, setor e localidade, persistir lançamentos no banco central e manter histórico de revisão e aprovação.

O navegador conversa somente com a aplicação HTTPS. A API é responsável por autorizar e validar cada ação e por acessar o banco. Rascunhos e formulários ficam em tabelas operacionais `op_logistica_*`; não devem ser gravados diretamente nas tabelas fato mensais do BI.

### Primeira versão proposta

Até confirmação do gestor, usar como hipótese de planejamento uma primeira entrega focada em:

- navegação básica do portal e área de Entregas;
- lançamento diário agregado por localidade/equipe, sem assumir que `data + localidade + motorista` seja chave única;
- rascunho, edição enquanto permitido, envio e histórico;
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
| 3 | Revisar modelo e criar banco operacional | Modelos e migration aplicados em desenvolvimento/staging | Etapas 0 e 1 |
| 4 | Implementar autenticação e autorização | Sessão/identidade e escopos aplicados no servidor | Etapas 0–3 |
| 5 | Entregar fluxo de Entregas | Criar, editar rascunho, enviar e consultar lançamentos | Etapas 3 e 4 |
| 6 | Completar cadastros, revisão e feedback | Gestão de catálogos e workflow aprovado | Etapas 4 e 5; política de feedback |
| 7 | Entregar indicadores e relatórios | Consultas e exportações limitadas pelo mesmo escopo | Definições de negócio aprovadas |
| 8 | Publicar dados no modelo analítico | Carga idempotente de revisões aprovadas, sem duplicidade | Dono da métrica e contrato com BI/ETL |
| 9 | Fazer piloto e liberar o MVP | Operação de Entregas acompanhada e aceite dos gestores | Etapas anteriores e release aprovado |
| 10 | Adicionar outros setores | Formulários próprios de Frota, CD e novos setores | MVP aceito; descoberta e aceite de cada setor |

## 3. Etapas de implementação

### Etapa 0 — Fechar as decisões que definem o produto

**Objetivo:** evitar que as tabelas, permissões e telas sejam construídas sobre regras ainda incertas.

**O que fazer:**

1. Confirmar se o MVP terá somente o lançamento e histórico de Entregas ou se precisa reproduzir as cinco abas do protótipo.
2. Confirmar a granularidade: resumo diário por localidade/equipe, rota ou pedido; registrar se pode haver mais de um lançamento para a mesma data e localidade.
3. Definir quem cria, envia, devolve, aprova, cancela e corrige um lançamento aprovado; decidir se o autor pode aprovar o próprio registro.
4. Aprovar a matriz de perfis e escopos: ações de cada perfil e setores/localidades disponíveis para cada pessoa. Não inferir autorização apenas pelo cargo.
5. O login local por username e senha está decidido. Definir provisionamento/ativação de contas, senha inicial, recuperação, necessidade de MFA, duração da sessão e quem pode conceder perfis/escopos.
6. Decidir se nome do cliente é necessário em feedback, quem pode consultar/exportar esses dados e qual é o prazo de retenção. Feedback só entra no escopo quando isso estiver definido.
7. Aprovar a fórmula, o nome e a meta dos indicadores. Os campos atuais não demonstram pontualidade; sem novos dados e regra, não apresentar a taxa de conclusão como OTIF.
8. Decidir se ranking individual é necessário e qual regra atribui resultados coletivos a cada participante. Sem regra aprovada, mostrar resultados por equipe ou agregados.
9. Definir catálogo/banco operacional, grants de leitura e escrita e forma de sincronizar localidades e pessoas.
10. Confirmar o serviço AWS/VPC que hospedará a API, endpoint HTTPS, Security Groups e secrets para a RDS privada; a Vercel hospeda o frontend estático.
11. Aprovar o que fica fora do MVP (CSV, PDF/impressão, painel, ranking e feedback) e registrar responsáveis pelas decisões.

**Entregáveis:** registro das decisões no contexto mestre do projeto; backlog do MVP; matriz perfil × ação × escopo; diagrama de implantação escolhido.

**Critério para avançar:** grão, fluxo de aprovação, identidade, política de PII, destino das tabelas e caminho de rede estão definidos. O layout e as rotas com fixtures podem avançar enquanto decisões não bloqueantes são fechadas; dados reais, migration final e publicação ficam aguardando as decisões que os afetam.

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

### Etapa 3 — Revisar o modelo operacional e implementar a migration

**Objetivo:** criar a persistência necessária para lançamentos, revisões, autorização e auditoria sem alterar o modelo analítico existente.

**O que fazer:**

1. Revisar o DBML operacional após as decisões da Etapa 0. Confirmar as entidades necessárias ao MVP e retirar ou adiar tabelas sem uso imediato, sem perder as regras de histórico e autorização.
2. Confirmar códigos estáveis para setor, localidade, pessoa e motivo. Localidade deve vir de catálogo aprovado; não aceitar texto livre como identificador de filial.
3. Revisar os 26 modelos SQLAlchemy do backend do portal contra o DBML; conferir FKs, índices e checks. A migration inicial do catálogo compartilhado inclui as 20 tabelas centrais e as seis classificadas como opcionais.
4. Definir constraints e índices: username normalizado único, CPF opcional único quando informado, credencial um-para-um, UUIDs/idempotência, não negatividade, estados válidos, vigência de catálogos e consultas usuais por status/data/localidade/autor.
5. Implementar transações para salvar cabeçalho, revisão, participantes, motivos e eventos correspondentes juntos. Mudanças de permissão/escopo e seu registro em `op_logistica_autorizacao_evento` também devem ser atômicos; revogações exigem motivo. Regras entre linhas, como soma de motivos, devem ser validadas no serviço antes de confirmar a transação.
6. Gerar uma migration incremental revisada. Se o catálogo for compartilhado, coordenar a sequência Alembic com o dono do banco; não editar ou reaplicar a baseline analítica de 15 tabelas.
7. Aplicar a migration somente em desenvolvimento/staging. Conferir constraints, índices, permissões SQL e restauração a partir do backup.
8. Carregar/sincronizar localidades e catálogos aprovados de forma idempotente; manter histórico por desativação/vigência em vez de apagar registros usados.

**Entregáveis:** DBML atualizado; modelos ORM revisados; migration incremental; catálogo inicial aprovado; banco de staging com tabelas operacionais.

**Critério para avançar:** staging contém o modelo operacional aprovado, sem mudança nas 15 tabelas analíticas de baseline, e as credenciais do portal não concedem leitura ampla desnecessária.

### Etapa 4 — Implementar identidade e autorização no servidor

**Objetivo:** garantir que cada consulta e comando respeite pessoa, ação, setor e localidade autorizados.

**O que fazer:**

1. Implementar login local, logout, expiração e invalidação de sessão. Verificar a senha por comparação com o hash Argon2id; nunca persistir a senha em texto puro. Se houver sessão por cookie, usar atributos seguros e proteção CSRF nas ações de escrita.
2. Resolver a conta por username normalizado; não usar nome, CPF, IDs de perfil ou campos enviados pelo navegador como prova de autorização.
3. Resolver no servidor as concessões vigentes de usuário, perfil e escopo. Papéis e IDs recebidos do navegador nunca são prova de permissão.
4. Criar dependências de autorização para ações como `VER`, `CRIAR`, `EDITAR_RASCUNHO`, `ENVIAR`, `DEVOLVER`, `APROVAR`, `CANCELAR`, `ADMINISTRAR_CADASTROS` e `EXPORTAR`, conforme matriz aprovada.
5. Aplicar filtros de setor/localidade dentro dos repositórios e queries antes de paginação ou retorno. Verificar também que o objeto alterado pertence ao escopo.
6. Implementar `GET /api/v1/me` com identidade e capacidades calculadas pelo servidor para montar a navegação.
7. Tratar conta inativa, concessão vencida e ausência de escopo como acesso negado por padrão; limitar tentativas de login e registrar eventos relevantes sem expor senha, hash ou CPF.

**Entregáveis:** login/logout local; verificação segura da credencial; resolução de perfis/escopos; política central de autorização; endpoint `/me`; navegação conforme capacidades.

**Critério para avançar:** chamadas HTTP diretas não permitem ler ou alterar lançamento de outra localidade, trocar autor/perfil nem executar ação sem a concessão correspondente.

### Etapa 5 — Construir a primeira fatia vertical: Entregas

**Objetivo:** percorrer o ciclo completo de um lançamento diário, da tela até o banco e de volta ao histórico.

**O que fazer:**

1. Implementar catálogos de localidades autorizadas, pessoas ativas e motivos ativos para alimentar os campos do formulário.
2. Criar formulário de entrega com data, localidade, motorista obrigatório, até dois ajudantes opcionais, realizadas, não realizadas, motivos com quantidades e observação, conforme o contrato aprovado.
3. Não impor chave única apenas por data/localidade/motorista. Gerar UUID estável de item e aplicar somente a regra de duplicidade definida para o grão aprovado.
4. Criar operação de salvar rascunho e operação de envio. Receber chave de idempotência para que retry após timeout não crie lançamento duplicado.
5. Validar no backend campos obrigatórios, data, escopo, estado ativo dos participantes/motivos, quantidades não negativas, total maior que zero e soma dos motivos igual ao total não realizado quando aplicável.
6. Salvar os dados do lançamento, participantes, motivos e evento de auditoria na mesma transação; mostrar erros associados ao campo e preservar o rascunho quando a validação falhar.
7. Implementar histórico paginado e filtros de data, localidade, estado, autor e equipe, sempre limitados pelo escopo do usuário.
8. Permitir edição somente no estado e pelas pessoas aprovadas. Após envio/aprovação, correções criam nova revisão vinculada à anterior, sem sobrescrita silenciosa.

**Entregáveis:** formulário funcional; endpoints de catálogo e Entregas; gravação transacional; histórico e edição permitida; eventos de auditoria.

**Critério para avançar:** o lançamento persiste entre dispositivos, as regras são validadas no servidor, retries não duplicam registros e o histórico respeita o escopo.

### Etapa 6 — Completar workflow e cadastros; adicionar feedback quando autorizado

**Objetivo:** controlar a passagem de dados de rascunho para revisão e manter referências confiáveis.

**O que fazer:**

1. Implementar estados aprovados pelo negócio: por exemplo, `RASCUNHO`, `ENVIADA`, `EM_REVISAO`, `DEVOLVIDA`, `APROVADA` e `CANCELADA`.
2. Implementar ações de envio, tomada de revisão, aprovação, devolução com justificativa, cancelamento e correção por nova revisão. Validar permissão e escopo em cada transição.
3. Registrar estado anterior/novo, ator, timestamp e comentário em log append-only. Não apagar histórico aprovado por operação comum.
4. Restringir criação, atualização e desativação de pessoas/motivos a perfis com permissão. Preservar referências históricas e vigência.
5. Caso feedback esteja aprovado para o MVP ou versão seguinte, criar cadastro e formulário próprios para elogio/reclamação, participantes, localidade e descrição. Aplicar leitura/exportação e retenção mais restritas aos dados do cliente e do relato.
6. Não habilitar pontuação individual de feedback até a política de uso e visibilidade estar aprovada.

**Entregáveis:** fluxo auditável de revisão; telas de fila e detalhe para aprovadores; manutenção controlada de catálogos; módulo de feedback somente se autorizado.

**Critério para avançar:** só pessoas autorizadas revisam no escopo concedido; devoluções têm motivo; correções preservam versões; dados pessoais ficam visíveis apenas aos perfis aprovados.

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

**Objetivo:** publicar somente revisões aprovadas e evitar perda, duplicidade ou soma entre fontes diferentes.

**O que fazer:**

1. Para cada métrica, registrar origem oficial (portal, SEAC, Cobli, CTA ou arquivo), processo responsável pela publicação e regra para divergências/substituições.
2. Mapear o grão e os campos do portal às fatos atuais. Quando as tabelas existentes não representarem o dia, equipe, motivo ou participantes, revisar DBML analítico antes de criar extensão/migration.
3. Não misturar a tabela operacional com `fato_entregas_mensais` nem converter feedback em devolução/ocorrência sem regra de negócio explícita.
4. Implementar publicação de revisões `APROVADA` com UUID de execução, `codigo_lancamento`, `codigo_revisao` e UUID de item. O reprocessamento da mesma revisão deve ser idempotente.
5. Atualizar a versão atual de uma revisão e registrar a anterior transacionalmente; preservar linhagem, contagens, erros e resultado da carga em `op_logistica_publicacao` e correlacionar com `etl_logistica_execucao` quando o catálogo permitir.
6. Coordenar DBML, models e migrations com BI/automação se compartilharem catálogo ou fatos. Manter uma cadeia Alembic coerente por catálogo.
7. Executar publicação em staging e comparar com fontes e controles aprovados. Rodar portal em paralelo à planilha/ETL pelo período definido com o gestor.

**Entregáveis:** contrato de publicação por métrica; serviço idempotente; rastreabilidade entre operação e fato; reconciliação aprovada em staging.

**Critério para avançar:** somente revisões aprovadas chegam ao modelo analítico, reprocessamentos não duplicam medidas e portal/ETL não contam o mesmo indicador duas vezes.

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

1. Levantar responsáveis, rotina, usuário lançador/aprovador, fonte atual e motivo para captura manual.
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
- [ ] Um lançamento válido pode ser salvo, retomado, enviado e encontrado no histórico em outro dispositivo.
- [ ] Quantidades e soma dos motivos são validadas pela API, dentro de transação.
- [ ] Retry de criação/envio não cria duplicata.
- [ ] Edição, devolução, aprovação e correção seguem as permissões e deixam revisão/evento auditável.
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
