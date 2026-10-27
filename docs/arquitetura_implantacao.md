# Arquitetura e conexão com a RDS

**Status em 27/10/2026:** o endpoint HTTPS e a conexão de staging com `vilarejo_bi_logistica_staging` foram confirmados. A migration `d2a8f6c1b904` foi aplicada e a cadeia está em `d2a8f6c1b904 (head)`. Vyctor e a gerente de Suporte estão carregando os cadastros oficiais. O código da API real, ORM, administração, lançamentos e indicadores foi atualizado para grupo de motivo, tipo própria/terceirizada e observação por motivo; ainda falta publicar esta versão e fazer o aceite funcional conectado ao banco. Para validar sem RDS, use o MySQL local isolado descrito em [rodar-localmente.md](./rodar-localmente.md).

## Componentes

O portal usa frontend e backend separados dentro do mesmo repositório. O backend é um monólito modular: uma API e um deploy, com módulos organizados por domínio. Essa estrutura deixa a interface e a API independentes sem introduzir serviços distribuídos antes de haver necessidade.

```mermaid
flowchart LR
    P[Pessoa usuária] -->|HTTPS| V[Frontend React + TypeScript na Vercel]
    V -->|HTTPS / JSON| LB[ALB ou proxy aprovado]
    LB -->|TCP 8081 privado| N[Nginx de Logística em EC2]
    N -->|rede Docker| A[API FastAPI]
    A -->|TCP 3306 privado| R[(RDS MySQL)]
    S[ERP SEAC] -->|Conector de backend autorizado| I[Importação idempotente e mapeada]
    I --> A
    D[Desenvolvedor] -->|HTTPS local| VDEV[Frontend Vite local]
    VDEV -->|localhost:8000| ADEV[API executada no host]
    ADEV -->|127.0.0.1:porta local| T[Processo SSH local]
    T -->|Tailscale ou SSH| E[EC2]
    E -->|TCP 3306 privado| R
```

Em produção, somente a API na AWS acessa o endpoint privado da RDS. A RDS não deve ser aberta à internet nem acessada pelo navegador. O frontend Vercel conhece apenas a URL HTTPS da API. A integração futura com SEAC também deve executar no backend, usando uma conta técnica de leitura e sem expor segredo ao navegador.

## Desenvolvimento local isolado

O `compose.yaml` do portal sobe um MySQL separado chamado `op_logistica_dev`, a API e o frontend. O comando local de bootstrap cria o schema do modelo ORM atual, perfis de teste, catálogos fictícios e a primeira conta `DEV`. Ele recusa qualquer banco que não seja local e não configura acesso ao RDS.

Esse modo serve para validar login e rascunhos. Para integração com dados empresariais, a conexão à RDS continua dependendo de endpoint, credenciais, rota e aprovações de Infra descritas abaixo.

## Conexão ao banco compartilhado no desenvolvimento

Para desenvolvimento contra staging, a API executada diretamente no host pode gerenciar o túnel SSH local até a RDS. Com `USE_DB_TUNNEL=true`, o backend inicia o cliente OpenSSH; com `USE_TAILSCALE=true`, usa `TAILSCALE_EC2_IP` como destino SSH da EC2. A URL da aplicação é redirecionada para `127.0.0.1` na porta local encaminhada. Ao encerrar a API, o processo SSH também é encerrado.

O Tailscale precisa estar instalado e conectado no computador do desenvolvedor e na EC2. A política da tailnet e o SSH da EC2 devem permitir essa conexão; a Security Group da RDS permite MySQL a partir da EC2. A chave indicada por `SSH_KEY_PATH` fica no computador, com permissão `0600`, e seu conteúdo não é copiado para o repositório ou para a imagem.

O Compose local normal continua isolado no MySQL `op_logistica_dev` e não carrega esse `.env`. A API em staging/produção na EC2 mantém `USE_DB_TUNNEL=false` e acessa a RDS pela VPC, sem depender do Tailscale.

## Conexão em staging e produção

O backend implantado na AWS deve conectar diretamente ao endpoint privado da RDS na porta 3306. Isso requer:

1. executar a API na EC2 escolhida, dentro da VPC/sub-redes autorizadas;
2. permitir TCP 3306 no Security Group da RDS com origem no Security Group da API (ou outra regra interna aprovada);
3. fornecer credencial de runtime por mecanismo de segredos aprovado, com privilégios mínimos sobre as tabelas operacionais;
4. manter uma credencial separada para migrations, liberada somente na etapa controlada de release;
5. separar endpoints, credenciais e catálogos de staging e produção.

O backend do Portal é executado na EC2 e acessa a RDS diretamente pela rede privada; não abre túnel SSH por requisição. O túnel SSH via EC2/Tailscale continua sendo somente uma opção para desenvolvimento local. A configuração em [`deploy/ec2/`](../deploy/ec2/README.md) usa Docker Compose, Nginx na porta 8081 do host (a 8080 já é usada pelo BI) e FastAPI somente na rede Docker. Em staging, o HTTPS já foi confirmado pela rota do proxy do BI `/logistica-staging/`, encaminhada à porta 8081. A topologia de produção permanece a definir.

## Integração prevista com o ERP SEAC

Antes do lançamento oficial do Portal, está prevista uma integração de entrada para buscar automaticamente no ERP os dados necessários aos lançamentos. A aplicação não deve acessar o SEAC pelo navegador. Um adaptador/worker de backend usará uma fonte oficialmente autorizada (API, consulta somente leitura ou exportação estruturada), códigos estáveis, idempotência, trilha de origem e reconciliação. Precisam ser definidos com a equipe SEAC os campos, frequência, credenciais técnicas, tratamento de divergências e se cada carga será criada como rascunho para conferência ou confirmada automaticamente. Esse fluxo é separado da integração analítica do VilarejoBI e da automação mensal das planilhas.

## Variáveis de ambiente

O `compose.yaml` fornece configurações seguras para o MySQL local isolado. Nos ambientes compartilhados, configure as variáveis da API no serviço de execução e armazene os segredos no mecanismo aprovado pela Infra; não coloque credenciais no frontend, em `VITE_*` ou no repositório.

| Variável | Uso |
|---|---|
| `APP_ENV` | Seleciona o ambiente da API (`local`, `staging` ou `production`). |
| `API_PREFIX` | Prefixo versionado das rotas HTTP. |
| `SESSION_SECRET` | Segredo aleatório com pelo menos 32 bytes; obrigatório em staging e produção e armazenado no gerenciador de segredos. Em desenvolvimento local, se omitido, uma chave efêmera é gerada para o processo. |
| `SESSION_TTL_MINUTES` | Duração absoluta da sessão em minutos; padrão de 720 (12 horas), sem renovação automática. |
| `SESSION_COOKIE_NAME` | Nome do cookie de sessão; padrão `op_logistica_session`. |
| `SESSION_COOKIE_SECURE` | Controla o atributo `Secure`; ativado por padrão fora dos ambientes locais. `SameSite=None` exige `Secure`. |
| `SESSION_COOKIE_SAMESITE` | `lax`, `strict` ou `none`; escolher conforme os domínios finais do frontend e da API. |
| `LOGIN_RATE_LIMIT_ATTEMPTS`, `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | Limite local de tentativas; o controle em memória serve a um processo. Antes de produção, mover o limite para um gateway ou serviço compartilhado. |
| `CORS_ALLOWED_ORIGINS` | Origens web autorizadas a chamar a API. Configurar Vercel Preview e domínio oficial conforme política. |
| `OP_LOGISTICA_DATABASE_URL` | Conexão de runtime com o catálogo operacional; nunca é variável do frontend. |
| `OP_LOGISTICA_MIGRATION_DATABASE_URL` | Conexão privilegiada para etapa controlada de migrations; não deve ser disponibilizada à API em produção. |
| `USE_DB_TUNNEL`, `USE_TAILSCALE`, `TAILSCALE_EC2_IP`, `EC2_HOST`, `RDS_ENDPOINT`, `SSH_KEY_PATH` | Configuração opcional do túnel SSH da API local executada no host. Na EC2, mantenha `USE_DB_TUNNEL=false` e conecte diretamente à RDS. |
| `VITE_API_BASE_URL` | URL pública da API ou caminho relativo servido por rewrite, embutido no frontend no build; não colocar segredo nesse valor. |

O catálogo operacional de staging confirmado é `vilarejo_bi_logistica_staging`, conforme o script de provisionamento seguro do Portal e o procedimento do VilarejoBI. Endpoint RDS, credenciais e regras de rede devem ser obtidos com BI/Infra; não deduzir esses valores do nome do catálogo. O catálogo e as credenciais de produção continuam separados e fora deste deploy base.

O `.env` já existente em `backend/` é local, não rastreado, modo `0600` e configurado para staging via túnel Tailscale. O modelo sem segredos está em [`backend/.env.example`](../backend/.env.example); ele usa os nomes esperados pelo código do Portal, diferentes de `ENVIRONMENT`, `DATABASE_URL` ou `LOGISTICA_DATABASE_URL` dos outros repositórios. O arquivo local não é enviado à EC2. Os exemplos de runtime da EC2 estão em [`deploy/ec2/api.env.example`](../deploy/ec2/api.env.example); na instância, os valores reais ficam em `${EC2_DEPLOY_DIR}/.env`, ao lado do `compose.yaml`, seguindo o padrão do VilarejoBI. O arquivo pertence ao usuário de deploy e usa modo `0600`; o `.gitignore` ignora `.env`. O arquivo da chave SSH nunca deve entrar no repositório ou na imagem.

## Pastas e responsabilidades

```text
LancamentoLogistica/
  backend/
    app/
      api/v1/                 # Composição das rotas e dependências HTTP
      core/                   # Configuração, banco, segurança, logs e erros
      modules/
        auth/                 # Login e sessão
        access_control/       # Perfis, permissões e escopos
        catalogs/             # Setor, localidade, pessoas e motivos
        deliveries/           # Lançamentos diários de Entregas
        workflow/             # Transições legadas; correções e cancelamentos auditáveis
        feedback/             # Consulta, lançamento e exportação de elogios/reclamações
        audit/                # Trilha de ações
    migrations/               # Ambiente Alembic e revisões incrementais
  frontend/
    src/app/                  # Composição, navegação e layout
    src/shared/               # Cliente HTTP e componentes comuns
    src/features/             # Funcionalidades agrupadas por domínio
    src/styles/               # Estilos globais e tokens visuais
  docs/                       # Especificação, plano, DBML e arquitetura
```

Os mapeamentos ORM das tabelas operacionais do DBML estão registrados em
backend/app/model_registry.py. O bootstrap usa esses modelos somente para criar a base local de
teste. Bancos compartilhados continuam dependendo da cadeia Alembic responsável e de uma etapa
controlada de migration.

## Publicação do frontend

Na configuração do projeto Vercel, usar `frontend/` como **Root Directory**, `npm run build` como comando de build e `dist` como diretório de saída. Definir `VITE_API_BASE_URL` por ambiente. Como esse valor é enviado ao navegador, ele pode conter somente uma URL pública ou um caminho relativo, nunca segredo.

Para o piloto operacional em staging, configurar `VITE_API_BASE_URL=/api/v1` e `VITE_DEMO_MODE=false` no ambiente **Preview** usado pela branch `staging`. O [`frontend/vercel.json`](../frontend/vercel.json) encaminha essa rota para `https://api-bi.vilarejosolucoes.com.br/logistica-staging/api/v1/`; assim, as chamadas usam a API de staging pelo mesmo domínio do portal. Autorizar a origem exata do deployment em `CORS_ALLOWED_ORIGINS`.

Para coletar feedback visual antes de publicar API ou banco, pode-se usar uma Preview isolada: em uma branch não produtiva, configurar `VITE_DEMO_MODE=true` apenas no ambiente **Preview**. Esse modo força os adaptadores de demonstração, ignora a URL de API configurada e mantém alterações no armazenamento local de cada navegador; não chama API nem acessa banco. Deixar `VITE_DEMO_MODE=false` em **Production** e não promover essa Preview. Compartilhar somente a URL da branch Preview; deploys Preview são públicos por padrão, salvo se a proteção de deploy estiver ativada.

Configurar CORS no backend para as origens oficiais e de preview que forem aceitas. A API precisa de endpoint HTTPS público protegido por autenticação e controles de rede; a conexão da API à RDS permanece privada dentro da AWS.

## Próximos passos antes do piloto

- **Decisões usadas no primeiro corte:** quatro grupos controlados (`TRANSPORTE_PROPRIO`, `TRANSPORTE_TERCEIRIZADO`, `LOJA`, `LOGISTICA`); equipes novas devem ter participantes de um mesmo tipo; registros históricos sem grupo/tipo ficam sem classificação até conferência. Os percentuais mostram participação entre as não realizadas e incidência sobre o total registrado.
- **Ranking:** os motivos associados às equipes aparecem por pessoa como contexto coletivo; o score continua em +1 por elogio e −1 por reclamação. Não somar ocorrências entre pessoas nem alterar o peso dos motivos sem regra aprovada.
- **Migration:** `d2a8f6c1b904` (down revision `c9b61a2f4d80`) foi aplicada em staging e conferida como `head`.
- **API e interface:** os contratos, serviços, cadastros, formulário de Entregas, histórico, CSV e painel foram atualizados no código desta versão; faltam CI no GitHub, publicação da API/frontend e aceite funcional em staging.
- **Cadastros/aceite:** acompanhar a carga feita por Vyctor e pela gerente de Suporte, reclassificar cada pessoa e motivo atual e testar os fluxos com contas/escopos reais do piloto. Não inventar grupo/tipo para registros antigos.
- **SEAC:** definir acesso, campos, frequência, idempotência e estado de importação; implementar o conector de backend antes do lançamento oficial.
- **Produção:** preparar publicação de produção depois do piloto; não reutilizar o banco, secrets nem workflow de staging.
- **Operação:** completar a revisão de acessibilidade/responsividade, confirmar backup/restauração e logs/monitoramento antes de produção.
