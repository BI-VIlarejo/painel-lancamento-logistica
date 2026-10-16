# LancamentoLogistica

Portal web próprio para registrar dados operacionais de Logística, separado do VilarejoBI e da automação de planilhas.

## Arquitetura escolhida

- `frontend/`: aplicação React + TypeScript + Vite, publicada como site estático na Vercel.
- `backend/`: API FastAPI organizada como monólito modular, empacotada em Docker e executada na AWS, dentro da VPC com acesso à RDS.
- O navegador chama a API por HTTPS. Somente a API acessa o MySQL; o frontend não recebe credenciais de banco.
- Em desenvolvimento, a conexão à RDS pode passar por um túnel SSH via EC2/Tailscale, como no fluxo local do VilarejoBI. Em execução na AWS, a API deve usar a rota privada da VPC até a RDS, sem túnel SSH por requisição.

O destino exato da API na AWS (EC2 ou serviço de containers) e as regras de Security Group ainda precisam ser confirmados com Infra. O scaffold prepara o backend em container sem presumir essa decisão.

## Estado deste scaffold

A estrutura e as configurações iniciais estão preparadas. Os modelos ORM das 26 tabelas
operacionais do DBML foram mapeados e registrados em backend/app/model_registry.py; seis estão
marcados como opcionais, fora do primeiro escopo de migration. Rotas funcionais, login,
migrations e telas ainda não foram implementados, então o portal ainda não é executável como
produto.

O modelo operacional em `docs/modelo_operacional_lancamento_logistica.dbml` ainda requer revisão de escopo. Nenhuma migration foi gerada ou aplicada, e os modelos ORM não criam tabelas por conta própria.

## Documentação

- [Especificação detalhada](./docs/especificacao_portal_lancamento_logistica.md)
- [Plano de implementação](./docs/plano_implementacao.md)
- [Guia das tabelas operacionais](./docs/guia_tabelas_modelo_operacional.md)
- [Modelo operacional DBML](./docs/modelo_operacional_lancamento_logistica.dbml)
- [Arquitetura, pastas e conexão com a RDS](./docs/arquitetura_implantacao.md)
- [Contexto mestre de Logística](../docs/contexto_projeto_logistica.md)

## Preparação local

1. Copie `.env.example` para `.env` e preencha os valores de desenvolvimento fornecidos pela equipe. Não use credenciais de produção.
2. Para conectar ao banco de staging pela rede local, configure o túnel SSH aprovado conforme `docs/arquitetura_implantacao.md`.
3. Inicie a API em container com `docker compose up --build` quando o entrypoint FastAPI for implementado.
4. Em outro terminal, copie `frontend/.env.example` para `frontend/.env.local`, instale as dependências com `npm install` dentro de `frontend/` e inicie o servidor Vite com `npm run dev`.

Os comandos de execução estão registrados como referência, mas ainda não iniciam uma aplicação funcional: os arquivos de código são deliberadamente comentários, conforme o escopo deste scaffold.

## Publicação

Na Vercel, configurar `frontend/` como **Root Directory** e usar `npm run build` com saída em `dist`. A URL HTTPS da API será configurada em `VITE_API_BASE_URL`; esse valor é público e não pode conter segredos.

O backend deverá ser publicado no ambiente AWS aprovado, com URL HTTPS, logs e segredos gerenciados. Infra precisa liberar a comunicação da API com o endpoint privado da RDS na porta 3306 e configurar a origem do frontend em CORS. Migrations devem ser executadas como etapa controlada de release, nunca no build do frontend ou da imagem.
