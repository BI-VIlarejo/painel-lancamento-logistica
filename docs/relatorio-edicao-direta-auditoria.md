# Relatório: edição direta, auditoria e gráficos do painel

**Atualizado:** 27/10/2026
**Ambiente-alvo:** API real de staging. Produção continua sendo uma etapa posterior.

## Decisões aplicadas

- Editar uma pessoa ou um motivo atualiza o mesmo registro no banco. A operação preserva o ID/código e não insere outra versão.
- A auditoria registra campos anteriores e novos. Alterar nome/tipo da pessoa ou descrição/grupo do motivo também muda a forma de exibir lançamentos históricos ligados àquela linha; os eventos permitem rastrear essa alteração.
- O rótulo do campo de observação por motivo no formulário fica exatamente **Observação**.
- Os gráficos adicionados são resumos visuais. As tabelas atuais, incluindo **Ranking por pessoa**, **Performance por loja** e os detalhamentos de motivo/equipe, continuam no painel com as mesmas linhas e colunas.

## API, banco e trilha de auditoria

### Edição de cadastros

- `POST /api/v1/cadastros/pessoas` e `POST /api/v1/cadastros/motivos` criam novos cadastros; códigos já existentes não são usados para inserir uma nova versão.
- `PUT /api/v1/cadastros/pessoas/{id_pessoa}` atualiza nome, função e tipo de transporte no registro identificado.
- `PUT /api/v1/cadastros/motivos/{id_motivo_nao_entrega}` atualiza descrição e grupo no registro identificado.
- Os eventos `PESSOA_ATUALIZADA` e `MOTIVO_ATUALIZADO` são gravados na mesma transação da edição, com alvo, código e diffs permitidos.
- Não foi criada coluna nem tabela operacional nova. A migration `e31f9a7c2b64`, na cadeia Alembic `logistica` do repositório VilarejoBI, apenas amplia os CHECKs de tipo/alvo da tabela `op_logistica_autorizacao_evento` para aceitar esses dois eventos.
- Staging estava em `d2a8f6c1b904 (head)` antes da alteração. A migration `e31f9a7c2b64` foi commitada e enviada à branch `logistica` do VilarejoBI (`78e0b59`), aplicada no banco e confirmada como `head` em 27/10/2026.

### Quem fez e o que foi alterado

`GET /api/v1/audit/events` mantém a união de eventos de Entregas, Acessos e Feedback e agora fornece nome/username do ator, alvo e resumo de alterações seguras. A tela apresenta autoria e alvo para:

- cadastro e edição de usuários, redefinição de senha e ativação/desativação;
- criação/edição/ativação de perfil, recurso e permissão;
- concessão/revogação de escopo de usuário e de permissão a perfil;
- criação/edição/ativação/desativação de localidade, pessoa e motivo;
- rascunho, confirmação, correção e cancelamento de lançamento;
- feedback registrado.

O ator é resolvido pelo ID do evento e exibe o nome/username atual da conta. O resumo de alterações usa allowlist; não expõe hashes/senhas, motivos privados de revogação, comentários, relatos ou nomes de clientes. Eventos antigos que só possuem IDs continuam consultáveis com referência por ID.

Arquivos centrais: `backend/app/modules/access_control/service.py`, `backend/app/modules/audit/repository.py`, `backend/app/modules/audit/schemas.py`, `backend/app/modules/catalogs/admin_service.py`, `backend/app/modules/catalogs/router.py` e as telas `frontend/src/features/audit` e `frontend/src/features/administration`.

## Revisão visual do painel

| Indicador | Visual escolhido | Por que funciona melhor |
|---|---|---|
| Evolução do OTIF | Linha por dia ou mês | Mostra tendência ao longo do tempo e preserva a leitura temporal existente. |
| Proporção geral | Barra horizontal empilhada a 100% | Compara duas partes do mesmo total; legenda mostra quantidade e percentual. |
| Não realizadas por grupo de motivo | Barras horizontais, maior quantidade primeiro | Os quatro grupos têm nomes longos; a ordenação evidencia onde se concentra o volume. Cada linha traz participação nas não realizadas e incidência no total. |
| Entregas próprias/terceirizadas | Barra empilhada por tipo, com segmentos de realizadas/não realizadas | Compara composição de resultado entre os dois tipos; contagem, número de registros e taxa ficam visíveis junto à barra. |
| Não realizadas por motivo | Barras horizontais, maior quantidade primeiro | Funciona com muitos motivos e rótulos extensos; grupo e os dois percentuais permanecem junto à quantidade. |
| Taxa de realização por equipe | Barras horizontais de 0 a 100%, menor taxa primeiro | Evidencia equipes que precisam de atenção; volume e OTIF acompanham a taxa para evitar comparar grupos de tamanhos diferentes sem contexto. |
| Taxa de realização por loja | Barras horizontais de 0 a 100%, menor taxa primeiro | Ajuda a encontrar localidades com menor realização; volume e OTIF aparecem junto à barra. |

Os gráficos de grupo, tipo, motivo, equipe e loja foram acrescentados mantendo suas tabelas abaixo. O **Ranking por pessoa** e as demais tabelas não foram alterados nem substituídos. Fórmulas, filtros, contratos da API e estrutura do banco não mudaram por causa dos gráficos.

## Documentação atualizada

- `docs/especificacao_portal_lancamento_logistica.md`: regra de atualização no mesmo registro, efeito sobre leituras históricas e escolha visual de cada gráfico.
- `docs/plano_implementacao.md`: estado da migration pendente, edição direta, auditoria e critérios dos gráficos.
- `docs/guia_tabelas_modelo_operacional.md`: diferença entre colunas antigas de vigência e o fluxo atual, além do estado das migrations.
- `docs/modelo_operacional_lancamento_logistica.dbml`: anotações sobre efeitos da edição nos dados relacionados e observação por motivo.
- `docs/pendencias-para-retomada.md`: próximos passos de CI, migration, deploy e aceite do staging.

## Validação e publicação

- Frontend: `npm run typecheck` e `npm run build` concluíram com sucesso após os gráficos, a edição direta, a auditoria e o rótulo **Observação**.
- Backend: compilação Python (`compileall`/`py_compile`) e `git diff --check` concluíram sem erros.
- Os testes backend e Ruff não puderam ser executados neste checkout: não há `pytest`/`ruff` ou ambiente virtual do Portal disponível. O CI configurado para `staging` deve confirmar esses checks; o resultado remoto não foi consultado porque `gh` não está instalado neste ambiente.
- O commit do Portal `f73245c` foi enviado à branch `staging`. O workflow **Deploy Portal API to Staging** é manual e ainda precisa ser executado na branch `staging`. A nova prévia Vercel também precisa ser confirmada; a prévia `Ready` anterior é de uma publicação anterior.
- Ordem: confirmar CI → executar **Deploy Portal API to Staging** na branch `staging` → publicar/confirmar a nova prévia Vercel → validar edição direta, autoria/alvo/diffs e gráficos com Suporte. A migration `e31f9a7c2b64` já está aplicada em staging.
- Não promover para produção nesta etapa.

## Próximo trabalho

Antes do lançamento oficial, integrar a página de lançamento ao ERP SEAC pelo backend. Ainda precisam ser confirmados acesso e fonte autorizados, campos, frequência, idempotência e se dados importados entram como rascunho para conferência ou são confirmados automaticamente.
