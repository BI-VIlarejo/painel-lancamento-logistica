# Padrão de mensagens de commit

As mensagens de commit deste repositório seguem Conventional Commits e usam uma descrição curta, profissional e compatível com o conteúdo:

```text
tipo(escopo-opcional): resumo no imperativo
```

Prefixos usuais:

- `feat`: nova funcionalidade;
- `fix`: correção;
- `docs`: documentação;
- `refactor`: reorganização sem mudança funcional intencional;
- `perf`: melhoria de desempenho;
- `test`: inclusão ou alteração de testes;
- `chore`, `ci` e `build`: manutenção, integração contínua e processo de build.

Os resumos podem ser escritos em português. Não usar mensagens sem prefixo, genéricas ou coloquiais. Manter cada commit focado em um assunto; agrupar nele a documentação diretamente relacionada.

Esta regra também está registrada em [`AGENTS.md`](../AGENTS.md) para orientar agentes e futuras contribuições neste repositório.
