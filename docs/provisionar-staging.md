# Provisionar o primeiro acesso de staging

Este procedimento cria ou completa uma conta `DEV` global no catálogo operacional de staging. Ele não executa migrations, não usa o bootstrap local, não cria contas de teste e não se conecta ao VilarejoBI para ler dados.

## Pré-requisitos

- A migration `b817e6c2a904` já está aplicada no catálogo `vilarejo_bi_logistica_staging` (ela depende de `f3c8a1d6b907`).
- `APP_ENV=staging` e `OP_LOGISTICA_DATABASE_URL` apontam para esse catálogo. Use a credencial operacional de staging aprovada; não use a URL de migration nem a URL provisioner do VilarejoBI.
- O `.env` está fora do Git, com permissões restritas, e o comando é executado em um terminal interativo no host com acesso privado ao banco.
- O username que será usado pelo primeiro administrador foi combinado com a equipe.

## Executar

Na pasta `LancamentoLogistica/backend/`:

```bash
python -m scripts.provision_staging_dev
```

O comando valida `APP_ENV`, MySQL e o nome exato do catálogo. Em seguida pede duas confirmações interativas. Se a conta não existir, solicita o nome completo, gera uma senha numérica aleatória de seis dígitos, grava somente o hash e mostra a senha uma vez após a transação ser confirmada. Se a conta já existir e estiver ativa, preserva a senha atual e completa o perfil/escopo que estiver faltando.

O comando prepara os recursos e permissões definidos no código, os perfis padrão (incluindo `CADASTRADOR`, com manutenção de catálogos e consulta/exportação de feedback), o setor `SUPORTE`, o escopo global DEV e a primeira versão publicada do formulário de Entregas. Os tipos de feedback são códigos fixos no contrato da API. Lojas, pessoas e motivos reais devem ser cadastrados pela Administração do Portal. As alterações são idempotentes para os cadastros provisionados e falhas revertem a transação. Se encontrar definições inativas ou divergentes, ele para para revisão manual.

O provisionamento cria o setor `SUPORTE` sem reclassificar lançamentos que já estejam ligados a `ENTREGAS`. Também não migra escopos de usuários: conceda `SUPORTE` somente às contas autorizadas antes do piloto. Este script prepara apenas a conta DEV global; não o execute sem confirmar que a configuração de staging e as migrations estão corretas.

Uma conta com perfil `DEV` e escopo global recebe todas as permissões ativas do Portal, inclusive permissões novas ou personalizadas cadastradas depois do provisionamento. A API também mostra esse conjunto completo na consulta das permissões do perfil DEV. Essa regra entra em vigor ao publicar o backend atualizado; não exige migration nem alteração manual no banco. As permissões do perfil DEV não podem ser removidas uma a uma, pois isso não reduziria o acesso total.

O script não semeia lojas, pessoas ou motivos fictícios. Para demonstrar o fluxo sem dados reais, use registros claramente fictícios e identificados como demonstração; não carregue feedback com nome/relato real até definir o prazo de retenção e se os dados serão apagados ou anonimizados depois. `OPERADOR` pode manter os catálogos compartilhados e não pode abrir indicadores, auditoria nem usuários e acessos. Conceda esse perfil com os escopos de Suporte/localidade aprovados para a equipe de lançamento. Todos os perfis do piloto podem consultar/exportar feedback dentro dos respectivos escopos; somente quem tem `FEEDBACK_CLIENTES:CRIAR` registra ou importa. A senha temporária não deve ser colada em arquivos, tickets ou logs; entregue-a à pessoa por canal privado.

## O que não executar

- Não rode `docker compose ... bootstrap` contra staging.
- Não execute `alembic upgrade` por este procedimento.
- Não coloque credenciais em `VITE_*`, no repositório ou na linha de comando.
- Não use este script em produção: ele está travado no nome do catálogo de staging.
