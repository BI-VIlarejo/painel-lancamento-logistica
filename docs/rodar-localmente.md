# Rodar o portal funcional localmente

Esse fluxo sobe um MySQL próprio no Docker, a API e o frontend. Não usa RDS, staging, produção ou o banco do VilarejoBI.

O `backend/.env` é uma configuração separada para executar a API diretamente no host contra o staging compartilhado. Ele abre um túnel SSH via Tailscale quando `USE_DB_TUNNEL=true`; o Compose local define suas próprias variáveis e continua apontando para `op_logistica_dev`. O modelo sem segredos está em [`backend/.env.example`](../backend/.env.example). Use o modo staging somente com autorização e credencial operacional aprovada, pois as ações feitas na aplicação alteram a base compartilhada.

### Executar a API local contra staging via Tailscale

O Tailscale precisa estar conectado no computador e na EC2. A chave SSH deve existir e estar com permissão `0600`. No `backend/.env`, configure `USE_DB_TUNNEL=true`, `USE_TAILSCALE=true` e os valores de `TAILSCALE_EC2_IP`, `EC2_HOST`, `RDS_ENDPOINT` e `SSH_KEY_PATH`. `RDS_ENDPOINT` deve corresponder ao host da `OP_LOGISTICA_DATABASE_URL`.

Na pasta `LancamentoLogistica/backend/`, inicie a API:

```bash
source .venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Ao iniciar, a API abre o túnel e aponta a engine do SQLAlchemy para a porta local encaminhada. Ao encerrar, fecha o processo SSH. A API implantada na EC2 mantém `USE_DB_TUNNEL=false` e acessa a RDS diretamente pela VPC.

## Abrir somente o frontend, sem API ou banco

Na pasta `LancamentoLogistica/frontend/`:

```bash
npm ci
npm run dev:demo
```

Abra `http://localhost:5173` e clique em **Entrar na demonstração**. Esse modo não inicia a API nem conecta a banco; as alterações da prévia ficam somente no armazenamento local do navegador. Para apagar as alterações da demonstração, limpe os dados do site `localhost:5173` nas configurações do navegador.

## Iniciar o banco e criar o usuário DEV

Na pasta `LancamentoLogistica/`:

```bash
docker compose up -d db
docker compose --profile tools run --build --rm bootstrap
```

Se ainda não houver uma conta DEV global, o bootstrap cria as tabelas do modelo atual, carrega cadastros de teste e pergunta:

- username (por exemplo, `nome.sobrenome`);
- nome completo;
- senha e confirmação, digitadas sem aparecer no terminal.

Essa conta recebe o perfil `DEV`, escopo global e todas as permissões registradas neste portal, incluindo o Painel Gerencial. Se já existir uma conta DEV, o bootstrap atualiza as permissões do perfil e encerra sem criar outra conta ou alterar a senha. Se o terminal mostrar `Permissões locais do perfil DEV atualizadas; nenhuma conta foi alterada.`, foi isso que aconteceu.

### Criar uma conta DEV nova sem apagar o banco local existente

Para criar `dev-gabriel` sem substituir os dados do volume local atual, use outro nome de projeto Compose. Isso cria outro MySQL e outro volume. Execute na pasta `LancamentoLogistica/`:

```bash
docker compose down
docker compose -p lancamento-gabriel up -d db
docker compose -p lancamento-gabriel --profile tools run --build --rm bootstrap
docker compose -p lancamento-gabriel up -d --build api frontend
```

O primeiro comando para os serviços Compose do projeto padrão, mas preserva o volume atual. No bootstrap, informe `dev-gabriel`, seu nome completo e uma senha local de pelo menos seis caracteres (pode escolher uma senha numérica de seis dígitos). Depois abra `http://localhost:5173` e entre com essa conta. O projeto `lancamento-gabriel` usa um volume separado e não conecta ao staging, à RDS ou ao banco do BI.

Se já houver outro container usando as portas 5173 ou 8000, ele precisa ser parado antes de iniciar a nova instância. Para voltar ao projeto Compose padrão, pare esta instância com `docker compose -p lancamento-gabriel down` e suba os serviços padrão novamente. Não use `down -v`: essa opção apaga o volume e os dados locais.

O ambiente local inclui correção versionada e cancelamento de lançamentos confirmados, consulta da trilha de eventos e API de reclamações/elogios. Vários feedbacks podem apontar para a mesma entrega confirmada. O feedback exige o nome do cliente conforme a decisão de produto e não aceita telefone, documento ou outros identificadores; o formulário permite selecionar motorista e até dois ajudantes, que precisam corresponder à equipe da entrega confirmada, enquanto loja e data são derivadas do vínculo. Para `POST /api/v1/feedbacks`, envie `Idempotency-Key` com um UUID novo por manifestação e reutilize-o em retries da mesma submissão. DEV, GESTOR e DIRETORIA recebem as permissões de gestão semeadas pelo bootstrap local; OPERADOR pode manter catálogos, consultar, registrar e editar rascunhos de Entregas, além de registrar/importar, consultar e exportar feedback dentro dos escopos concedidos, sem indicadores, auditoria ou usuários e acessos. CADASTRADOR mantém catálogos e consulta/exporta feedback, sem criar feedback nem administrar usuários. Use somente dados fictícios no desenvolvimento.

O bootstrap corrige, somente no MySQL local validado, a coluna opcional `criado_por`, a chave de idempotência e o índice de feedback, as colunas legadas de OTIF, cidade/UF e unicidade de localidade e os CHECKs antigos de `op_logistica_autorizacao_evento`. As colunas legadas de prazo/completude permanecem no banco, mas não são coletadas nem usadas no cálculo atual do OTIF. Ele vincula novos lançamentos ao setor `SUPORTE`; lançamentos antigos mantêm o setor já gravado. Em staging/produção, as evoluções de schema precisam entrar em uma revisão incremental da cadeia Alembic `logistica` mantida pelo VilarejoBI; não as aplique pelo bootstrap local nem pela inicialização da API.

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

O catálogo de localidades pertence ao portal e fica no banco operacional do próprio projeto. O portal não consulta nem sincroniza dados com o VilarejoBI.

## Criar usuários e definir acesso

O primeiro acesso DEV é criado pelo bootstrap acima. Para cadastrar os demais funcionários, entre no portal, abra **Cadastros → Usuários e acessos** e escolha **Nova conta**. Informe nome e username, selecione o perfil e indique se ele vale para todas as áreas, um setor, uma loja ou a combinação de setor e loja.

Ao confirmar, o portal cria a conta e a primeira concessão juntas. A senha inicial numérica de seis dígitos aparece uma única vez; envie-a em canal privado. A pessoa pode entrar com ela sem troca obrigatória, alterar a senha na área **Minha senha** ou redefini-la na tela de login informando o nome completo e o username. Depois é possível adicionar outros perfis/escopos ou revogar o acesso. As concessões não têm data de expiração configurável.

O perfil define as ações disponíveis; o escopo limita onde elas valem. A lista só mostra perfis que quem administra está autorizado a conceder. O perfil `DEV` exige escopo global.

## Verificações locais

Na pasta `backend/`, execute a suíte e a compilação da API com o Python do ambiente:

```bash
.venv/bin/python -m unittest discover -s tests -v
.venv/bin/python -m compileall -q app scripts tests
```

Na pasta `frontend/`, valide tipos e build:

```bash
npm run typecheck
npm run build
```

## Sobre a conta DEV inicial

O bootstrap pergunta seus dados; não fixa username ou senha no código nem no repositório. Ele só roda com `APP_ENV=local`, `LOCAL_DEV_BOOTSTRAP=1` e banco MySQL chamado `op_logistica_dev` em host local (`db`, `mysql` ou `localhost`).

Se o terminal responder `nvm: command not found` ao executar Vite no host, o nvm pode estar instalado sem ter sido carregado nesta sessão. O Compose já inclui Node 22 no container do frontend; não é necessário instalar Node no host para seguir este guia.

## Parar os serviços

```bash
docker compose down
```

Os dados de teste ficam no volume `logistica_db` e permanecem entre reinicializações do Compose.
