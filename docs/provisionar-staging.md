# Provisionar o primeiro acesso de staging

Este procedimento cria ou completa uma conta `DEV` global no catálogo operacional de staging. Ele não executa migrations, não usa o bootstrap local, não cria contas de teste e não se conecta ao VilarejoBI para ler dados.

## Pré-requisitos

- A migration `d7c9a4f2b610` já está aplicada no catálogo `vilarejo_bi_logistica_staging`.
- `APP_ENV=staging` e `OP_LOGISTICA_DATABASE_URL` apontam para esse catálogo. Use a credencial operacional de staging aprovada; não use a URL de migration nem a URL provisioner do VilarejoBI.
- O `.env` está fora do Git, com permissões restritas, e o comando é executado em um terminal interativo no host com acesso privado ao banco.
- O username que será usado pelo primeiro administrador foi combinado com a equipe.

## Executar

Na pasta `LancamentoLogistica/backend/`:

```bash
python -m scripts.provision_staging_dev
```

O comando valida `APP_ENV`, MySQL e o nome exato do catálogo. Em seguida pede duas confirmações interativas. Se a conta não existir, solicita o nome completo, gera uma senha numérica aleatória de seis dígitos, grava somente o hash e mostra a senha uma vez após a transação ser confirmada. Se a conta já existir e estiver ativa, preserva a senha atual e completa o perfil/escopo que estiver faltando.

O comando prepara os recursos e permissões definidos no código, os perfis padrão, o setor `Entregas`, o escopo global DEV e a primeira versão publicada do formulário. Os tipos de feedback são códigos fixos no contrato da API. Lojas, pessoas e motivos reais devem ser cadastrados pela Administração do Portal. As alterações são idempotentes para os cadastros provisionados e falhas revertem a transação. Se encontrar definições inativas ou divergentes, ele para para revisão manual.

Uma conta com perfil `DEV` e escopo global recebe todas as permissões ativas do Portal, inclusive permissões novas ou personalizadas cadastradas depois do provisionamento. A API também mostra esse conjunto completo na consulta das permissões do perfil DEV. Essa regra entra em vigor ao publicar o backend atualizado; não exige migration nem alteração manual no banco. As permissões do perfil DEV não podem ser removidas uma a uma, pois isso não reduziria o acesso total.

O script não semeia lojas, pessoas ou motivos fictícios. Depois do provisionamento, cadastre ou importe os registros reais pela Administração do Portal. A senha temporária não deve ser colada em arquivos, tickets ou logs; entregue-a à pessoa por canal privado.

## O que não executar

- Não rode `docker compose ... bootstrap` contra staging.
- Não execute `alembic upgrade` por este procedimento.
- Não coloque credenciais em `VITE_*`, no repositório ou na linha de comando.
- Não use este script em produção: ele está travado no nome do catálogo de staging.
