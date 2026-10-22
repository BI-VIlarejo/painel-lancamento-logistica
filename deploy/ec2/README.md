# API de staging na EC2

Esta configuração segue o padrão que o VilarejoBI já usa para os serviços em EC2: imagem da API publicada no GHCR, deploy controlado pelo GitHub Actions, FastAPI atrás do Nginx na porta 8080 do host e frontend publicado separadamente na Vercel. O TLS deve terminar no ALB ou no proxy corporativo aprovado pela Infra. O container da API não publica uma porta no host, não roda migrations ao iniciar e não publica o MySQL.

## Arquivos e variáveis

- `compose.yaml` usa a imagem `ghcr.io/bi-vilarejo/painel-lan-amento-logistica/backend` e sobe a API e o Nginx. O Nginx publica `8080:80`; o backend fica acessível somente pela rede interna do Compose.
- `nginx.conf` encaminha todas as rotas à API e repassa os cabeçalhos de proxy. Não há cache de respostas, pois a API atende sessões e operações de escrita.
- `/etc/lancamento-logistica/api.env` contém as variáveis privadas de runtime. Use `api.env.example` como lista de campos; mantenha o arquivo fora do Git, com proprietário `root` e modo `0600`.
- `backend/.env` e `backend/.env.example` são configurações locais. Nenhum deles é enviado à EC2.

Configure `APP_ENV=staging`, o catálogo `vilarejo_bi_logistica_staging`, a URL privada da RDS e uma credencial operacional aprovada com privilégio mínimo. Codifique caracteres especiais do usuário/senha em URL encoding. Não coloque `OP_LOGISTICA_MIGRATION_DATABASE_URL` no ambiente do serviço; a credencial de migration é separada e usada somente numa operação controlada.

Gere `SESSION_SECRET` com `openssl rand -hex 32`. Configure `CORS_ALLOWED_ORIGINS` com a origem exata do frontend, sem `/*` nem barra final. Para a sessão funcionar sem depender de cookies de terceiros, prefira um domínio próprio da Vercel e um domínio de API no mesmo domínio registrável, por exemplo `portal-staging.empresa.com` e `api-staging.empresa.com`. O backend usa `SESSION_COOKIE_SECURE=true` e `SESSION_COOKIE_SAMESITE=lax`.

Criação do arquivo privado na instância:

```bash
sudo install -d -o root -g root -m 700 /etc/lancamento-logistica
sudo install -o root -g root -m 600 /dev/null /etc/lancamento-logistica/api.env
sudoedit /etc/lancamento-logistica/api.env
```

## Rede AWS

O fluxo esperado é navegador → Vercel → HTTPS da API → ALB/proxy aprovado → EC2 na porta 8080 → RDS privada na porta 3306.

- DNS `api-staging` deve apontar para o ALB/proxy que termina TLS e encaminha para a EC2 na porta 8080. Configure certificado HTTPS nesse componente. Se a Infra já tiver um proxy padrão para o BI, reutilize a mesma solução aprovada.
- No Security Group da EC2, permita TCP 8080 somente a partir do Security Group do ALB/proxy. Permita SSH 22 apenas pelo acesso administrativo/deploy aprovado. Não abra 8000.
- No Security Group da RDS, permita TCP 3306 com origem no Security Group da EC2. Mantenha a RDS em sub-rede privada e sem acesso público.
- Use o papel IAM da instância para acesso a serviços AWS. Não instale access keys de usuário na EC2.
- O proxy precisa encaminhar `Host` e `X-Forwarded-Proto`; o Nginx repassa esses cabeçalhos à API.

O `docker-compose.prod.yml` do VilarejoBI publica o Nginx na porta 8080 e usa o backend na 8000. Aqui mantive o padrão de porta do Nginx, mas deixei a porta 8000 da API apenas interna ao Compose para evitar um caminho que contorne o proxy.

## Preparar a EC2

Depois que a Infra confirmar a instância, região, acesso administrativo, ALB/proxy e Security Groups:

1. Instale/valide Docker Engine e Docker Compose na EC2. O usuário de deploy precisa executar Docker sem `sudo` e gravar no diretório configurado em `EC2_DEPLOY_DIR`.
2. Crie `/etc/lancamento-logistica/api.env` com a credencial de runtime e os valores aprovados. Restrinja a leitura a `root`.
3. Confirme saída HTTPS da EC2 para GHCR e Docker Hub. A instância precisa baixar a imagem da API e `nginx:alpine`.
4. Na primeira implantação, prepare o diretório de deploy; o workflow copia `compose.yaml` e `nginx.conf` para ele.

## Publicar e implantar a imagem

O workflow [deploy-staging.yml](../../.github/workflows/deploy-staging.yml) segue o fluxo do BI, mas é disparado manualmente para não publicar automaticamente a cada push. Ele só executa quando a referência escolhida é a branch `staging`:

1. Acesse **GitHub → Settings → Environments → staging** e configure estes secrets:

   - `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` e `EC2_SECURITY_GROUP_ID`: credencial AWS restrita a autorizar/remover SSH na porta 22 somente no Security Group da EC2 de staging.
   - `EC2_HOST`, `EC2_USER`, `EC2_PRIVATE_KEY` e `EC2_HOST_FINGERPRINT`: acesso SSH da automação à instância. Verifique o fingerprint com a Infra por um canal confiável.
   - `EC2_DEPLOY_DIR`: diretório de deploy, por exemplo `/home/ubuntu/dev/lancamento-logistica/deploy/ec2`.

   `GITHUB_TOKEN` é fornecido automaticamente pelo Actions e permite publicar/baixar a imagem do pacote deste repositório. Não reutilize uma chave AWS com acesso amplo.

2. Confirme que a CI da branch `staging` passou. Em **Actions → Deploy Portal API to Staging → Run workflow**, selecione `staging` e execute.
3. O workflow constrói e publica uma imagem `staging-<commit>`, abre temporariamente SSH para o IP do runner, copia a configuração, atualiza os containers e remove a regra temporária no fim.
4. Confirme o estado dos containers na EC2 e acesse `https://api-staging.seudominio/health`.

Confira a conectividade de runtime com a RDS sem gravar dados:

```bash
docker compose --project-name logistica-staging -f compose.yaml exec -T backend python -m scripts.check_staging_db
```

Depois faça o deploy Preview do frontend com `VITE_API_BASE_URL=https://api-staging.seudominio/api/v1` e `VITE_DEMO_MODE=false`. Inclua a origem exata do frontend em `CORS_ALLOWED_ORIGINS` e valide login, sessão e um fluxo operacional controlado.

## Banco e migrations

As migrations da base compartilhada são coordenadas pela cadeia Alembic `logistica` mantida no VilarejoBI. Antes de expor a API, confirme que a revisão necessária para o Portal está aplicada no catálogo de staging. Use uma credencial de migration separada, fora do container da API e fora deste arquivo de runtime. Consulte [o guia do staging](../../docs/provisionar-staging.md) e [o guia de criação do banco do VilarejoBI](../../../VilarejoBI/docs/guia_criacao_banco_logistica_rds.md).

## Publicação na Vercel

No projeto Vercel, use `frontend/` como Root Directory. Para uma Preview conectada à API, configure `VITE_API_BASE_URL` com a URL HTTPS pública acima e `VITE_DEMO_MODE=false`. A variável `VITE_API_BASE_URL` é pública no bundle; nunca coloque credenciais nela. Configure a origem exata no `CORS_ALLOWED_ORIGINS` do arquivo de runtime e mantenha frontend/API sob o mesmo domínio registrável para cookies `SameSite=Lax`. Uma prévia somente visual usa `VITE_DEMO_MODE=true` e não aponta para a API nem para o banco.
