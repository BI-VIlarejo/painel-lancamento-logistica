# Migrations do backend

Os 26 modelos ORM operacionais estão mapeados em app/modules/*/models.py e registrados por
app/model_registry.py. A migration física pertence à cadeia `logistica` do Alembic do VilarejoBI,
porque as tabelas operacionais e analíticas compartilham o mesmo catálogo MySQL. Esta pasta não
deve iniciar uma segunda cadeia nem criar outra tabela `alembic_version` para esse catálogo.

Antes da primeira migration:

1. Aplicar `VilarejoBI/alembic/versions/logistica/e2b6d4a1c903_create_op_logistica_tables.py`
   pela cadeia `logistica`; ela cria todas as 26 tabelas do DBML, inclusive as seis classificadas
   como opcionais no registro de modelos.
2. Confirmar que o ambiente é staging e que o MySQL é 8.0.16 ou superior, pois o DBML usa CHECK.
3. Usar a credencial de migration separada da credencial de runtime. Revisar o estado e aplicar
   primeiro em staging; não executar migrations automaticamente no startup da API ou no build.
4. Para evoluções futuras, manter o DBML e os modelos do Portal sincronizados e criar revisões
   incrementais na mesma cadeia `logistica` do VilarejoBI.

Não executar migrations automaticamente no startup da API ou durante o build Docker.
