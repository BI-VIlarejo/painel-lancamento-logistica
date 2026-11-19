# Testes do backend

Os testes automatizados atuais cobrem autenticação e troca de senha, permissões do bootstrap,
regras de Entregas, cálculo de OTIF como não realizadas ÷ total registrado, ranking misto que exibe
o resultado coletivo da equipe para cada participante, versionamento e cancelamento, feedback com nome de cliente, escopo, vínculo
a Entrega confirmada, múltiplos feedbacks por entrega, idempotência, leitura de auditoria, cálculo/rotas de Fretes e agregações, permissões, paginação sob demanda e contagem constante de queries do Painel Gerencial de Transportes (`test_transport_analytics.py`). Eles usam
SQLite isolado e não acessam staging ou produção.

Na pasta `backend/`, execute:

```bash
python -m unittest discover -s tests -v
python -m compileall -q app tests scripts
```

Os fluxos que dependem da cadeia Alembic compartilhada ainda precisam de teste de
integração em um banco local efêmero depois que a migration for revisada e aprovada.
