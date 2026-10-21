# Testes do backend

Os testes automatizados atuais cobrem autenticação e troca de senha, permissões do bootstrap,
regras de Entregas, cálculo de OTIF a partir das contagens no prazo/completas, ranking sem duplicar
contagens nos ajudantes, versionamento e cancelamento, feedback com nome de cliente, escopo, vínculo
a Entrega confirmada, múltiplos feedbacks por entrega, idempotência e leitura de auditoria. Eles usam
SQLite isolado e não acessam staging ou produção.

Na pasta `backend/`, execute:

```bash
python -m unittest discover -s tests -v
python -m compileall -q app tests scripts
```

Os fluxos que dependem da cadeia Alembic compartilhada ainda precisam de teste de
integração em um banco local efêmero depois que a migration for revisada e aprovada.
