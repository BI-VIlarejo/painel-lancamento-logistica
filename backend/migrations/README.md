# Migrations do backend

Os modelos ORM operacionais estão em `app/modules/*/models.py` e são registrados por
`app/model_registry.py`. A migration física pertence à cadeia Alembic `logistica` do repositório
VilarejoBI, que administra o catálogo MySQL compartilhado. Não crie uma segunda cadeia ou outra
tabela `alembic_version` para o Portal. Essa responsabilidade pelo schema não conecta as aplicações:
o Portal não consulta nem publica dados no VilarejoBI neste release.

A cadeia operacional começa em `f4a7c9d2e1b6`; `e2b6d4a1c903` cria as tabelas operacionais,
`a92f7c31de04` acrescenta sessões, `c41d8e6f2b70` alinha a auditoria e valida as quantidades de
entrega, e `d7c9a4f2b610` atualiza OTIF, feedback e os tipos de auditoria. As migrations devem ser
revisadas contra o DBML e os modelos ORM.

`d7c9a4f2b610` adiciona `quantidade_entregas_no_prazo` e
`quantidade_entregas_completas`, ambas nullable para preservar registros legados sem inferir dados.
O CHECK `ck_op_logistica_entrega_otif_quantidades` exige ambas nulas ou ambas preenchidas entre zero
e `quantidade_realizada`.

A mesma revisão adiciona `criado_por` nullable e sua FK para usuários, e adiciona
`chave_idempotencia CHAR(36) NOT NULL` aos feedbacks. Ela preenche chaves UUID para os registros
existentes, cria `uq_op_logistica_feedback_idempotencia`, mantém o índice de suporte à FK de revisão
e remove a restrição que impedia vários feedbacks por item. `POST /api/v1/feedbacks` exige
`Idempotency-Key`: use uma chave UUID nova por manifestação e reutilize-a apenas ao repetir a mesma
submissão.

A revisão também alinha os CHECKs de autorização aos eventos de usuário e dos catálogos locais. Não
inclui evento nem endpoint para sincronização com o VilarejoBI. O downgrade é bloqueado se houver
feedbacks repetidos, autores, contagens OTIF ou eventos novos que seriam perdidos/rejeitados.

A revisão `f3c8a1d6b907` retira duas tabelas de publicação que não têm uso neste release, substitui
o catálogo de dois tipos fixos de feedback pelo campo `tipo` com CHECK e remove a tabela de
participantes do feedback, pois a equipe é derivada da entrega vinculada. Antes de qualquer DDL,
ela verifica se as tabelas de publicação estão vazias, se o catálogo contém apenas `ELOGIO` e
`RECLAMACAO`, se todo feedback está ligado a uma entrega e se as associações de pessoas coincidem
com as da entrega. Se alguma validação falhar, a migration para sem apagar essas informações. O
downgrade recria as tabelas e restaura a associação de participantes a partir da equipe da entrega.

Antes de aplicar, confirme a configuração de ambiente, a conexão de migration e a revisão atual. Use
MySQL 8.0.16 ou superior para aplicar os CHECKs. Aplique primeiro em staging, com credencial de
migration separada da credencial de runtime. Não execute Alembic no startup da API ou durante o build
Docker.

```bash
cd /home/vilarejo/projetos/ProjetoLogistica/VilarejoBI
backend/.venv/bin/alembic --name logistica current
backend/.venv/bin/alembic --name logistica upgrade head
backend/.venv/bin/alembic --name logistica current
```

Não execute o `upgrade` até confirmar que `ENVIRONMENT=staging`,
`LOGISTICA_DATABASE_NAME=vilarejo_bi_logistica_staging` e
`LOGISTICA_MIGRATION_DATABASE_URL` aponta para esse mesmo catálogo. Se `current` não corresponder
ao estado esperado, pare e reconcilie o histórico antes de qualquer `stamp` ou `upgrade`.
