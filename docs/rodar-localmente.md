# Rodar o portal funcional localmente

Esse fluxo sobe um MySQL próprio no Docker, a API e o frontend. Não usa RDS, staging, produção ou o banco do VilarejoBI.

## Iniciar o banco e criar o usuário DEV

Na pasta `LancamentoLogistica/`:

```bash
docker compose up -d db
docker compose --profile tools run --build --rm bootstrap
```

O bootstrap cria as tabelas do modelo atual, carrega cadastros de teste e pergunta:

- username (por exemplo, `nome.sobrenome`);
- nome completo;
- senha e confirmação, digitadas sem aparecer no terminal.

Essa conta recebe o perfil `DEV`, escopo global e todas as permissões registradas neste portal, incluindo o Painel Gerencial. Se já existir uma conta DEV, o bootstrap pode ser executado novamente para aplicar novas permissões ao perfil sem alterar a conta.

## Subir API e frontend

```bash
docker compose up -d --build api frontend
```

Abra:

- Portal: <http://localhost:5173>
- Documentação interativa da API: <http://localhost:8000/docs>
- Health check: <http://localhost:8000/health>

Entre com o username e a senha criados no bootstrap. O formulário recebe dados fictícios claramente nomeados como teste local: setor, localidade, motorista, ajudante e motivo de não entrega. Os lançamentos são gravados no MySQL local do Compose.

Os containers não precisam de Node.js instalado na máquina. Para executar somente o frontend no host, use Node 22 e configure `frontend/.env.local` com `VITE_API_BASE_URL=/api/v1`, `VITE_API_PROXY_TARGET=http://127.0.0.1:8000` e `VITE_DEMO_MODE=false`.

## Sincronizar lojas do Vilarejo BI

O catálogo local de lojas é um espelho de `dim_localidade`; o portal não cria códigos de loja. Para habilitar a ação **Sincronizar lojas do BI**, configure `VILAREJO_BI_LOGISTICA_DATABASE_URL` no ambiente do serviço `api` com uma conexão de leitura ao banco do BI. A conta do banco deve ter somente `SELECT` na dimensão `dim_localidade`. Não coloque credenciais reais no repositório.

O Compose local não conecta ao BI por padrão. Nesse ambiente, use as localidades fictícias carregadas pelo bootstrap. O botão de sincronização funciona quando a variável acima está configurada.

## Criar usuários e definir acesso

O primeiro acesso DEV é criado pelo bootstrap acima. Para cadastrar os demais funcionários, entre no portal, abra **Cadastros → Usuários e acessos** e escolha **Nova conta**. Informe nome e username, selecione o perfil e indique se ele vale para todas as áreas, um setor, uma loja ou a combinação de setor e loja.

Ao confirmar, o portal cria a conta e a primeira concessão juntas. A senha temporária aparece uma única vez; envie-a em canal privado. No primeiro login, a pessoa define sua senha. Depois é possível adicionar outros perfis/escopos ou revogar o acesso. As concessões não têm data de expiração configurável.

O perfil define as ações disponíveis; o escopo limita onde elas valem. A lista só mostra perfis que quem administra está autorizado a conceder. O perfil `DEV` exige escopo global.

## Sobre a conta DEV inicial

O bootstrap pergunta seus dados; não fixa username ou senha no código nem no repositório. Ele só roda com `APP_ENV=local`, `LOCAL_DEV_BOOTSTRAP=1` e banco MySQL chamado `op_logistica_dev` em host local (`db`, `mysql` ou `localhost`).

Se o terminal responder `nvm: command not found` ao executar Vite no host, o nvm pode estar instalado sem ter sido carregado nesta sessão. O Compose já inclui Node 22 no container do frontend; não é necessário instalar Node no host para seguir este guia.

## Parar os serviços

```bash
docker compose down
```

Os dados de teste ficam no volume `logistica_db` e permanecem entre reinicializações do Compose.
