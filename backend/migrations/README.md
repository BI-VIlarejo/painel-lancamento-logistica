# Migrations do backend

Os modelos ORM operacionais estão mapeados em app/modules/*/models.py e registrados por app/model_registry.py. A migration física pertence à cadeia logistica do Alembic do VilarejoBI, porque as tabelas operacionais e analíticas compartilham o mesmo catálogo MySQL. Esta pasta não deve iniciar uma segunda cadeia nem criar outra tabela alembic_version para esse catálogo.

Antes da primeira migration:

1. Aplicar a cadeia `logistica` do VilarejoBI em ordem: `e2b6d4a1c903` cria as tabelas
   operacionais-base, `a92f7c31de04` cria sessões e `c41d8e6f2b70` alinha a auditoria de
   autorização e as validações de quantidades. A cadeia começa em `f4a7c9d2e1b6`.
2. Confirmar que o ambiente é staging e que o MySQL é 8.0.16 ou superior, pois o DBML usa CHECK.
3. Usar a credencial de migration separada da credencial de runtime. Revisar o estado e aplicar
   primeiro em staging; não executar migrations automaticamente no startup da API ou no build.
4. Para evoluções futuras, manter o DBML e os modelos do Portal sincronizados e criar revisões
   incrementais na mesma cadeia `logistica` do VilarejoBI.

`c41d8e6f2b70` mantém `op_logistica_autorizacao_evento` sincronizada com o ORM: acrescenta
`id_recurso`, `detalhes`, a FK e o índice do recurso e atualiza os checks de tipo/alvo dos eventos.
Também impede uma linha de entrega sem contagens. A migration preserva a cadeia existente; não foi
aplicada ao banco.

A sincronização de localidades registra `LOCALIDADES_SINCRONIZADAS_BI`; antes de habilitá-la em um
banco já existente, a próxima revisão da cadeia `logistica` do VilarejoBI deve incluir esse tipo nos
checks de `op_logistica_autorizacao_evento`. Bases locais recém-criadas pelo ORM já incluem o tipo.

Não executar migrations automaticamente no startup da API ou durante o build Docker.
