# LancamentoLogistica

Portal web para registrar e acompanhar lançamentos operacionais de Logística, separado do VilarejoBI e da automação de planilhas.

## Rodar localmente

O projeto inclui Docker Compose com MySQL local isolado, API FastAPI e frontend React. Siga [o guia de execução local](docs/rodar-localmente.md) para preparar o banco, criar a primeira conta `DEV` e abrir o site sem modo demonstração.

O frontend usa a API por padrão. A demonstração só é ativada explicitamente com `VITE_DEMO_MODE=true`.

## Funcionalidades já conectadas à API

- Login, logout, sessão persistente e proteção CSRF.
- Consulta da identidade, permissões e escopos da conta.
- Administração de perfis, permissões e escopos pela API protegida.
- Leitura de catálogos, criação e edição de rascunhos, conferência e confirmação direta dos lançamentos de Entregas.
- Conta inicial `DEV` para desenvolvimento local, com acesso global às permissões deste portal.

Ainda não existe cadastro público ou tela de administração de usuários no portal. Contas adicionais são criadas por um comando local; o perfil e o escopo são concedidos pela API administrativa documentada no guia.

## Estrutura

- `frontend/`: aplicação React + TypeScript + Vite.
- `backend/`: API FastAPI, autenticação, controle de acesso, catálogos e lançamentos.
- `docs/`: especificação, modelo de dados e instruções operacionais.

## Documentação

- [Guia de execução local, contas e permissões](docs/rodar-localmente.md)
- [Especificação do portal](docs/especificacao_portal_lancamento_logistica.md)
- [Plano de implementação](docs/plano_implementacao.md)
- [Guia das tabelas operacionais](docs/guia_tabelas_modelo_operacional.md)
- [Modelo operacional DBML](docs/modelo_operacional_lancamento_logistica.dbml)
- [Arquitetura de implantação](docs/arquitetura_implantacao.md)
- [Contexto mestre de Logística](../docs/contexto_projeto_logistica.md)

## Publicação

O frontend pode ser publicado como site estático e configurado com a URL HTTPS pública da API em `VITE_API_BASE_URL`. O backend e o banco precisam ser publicados em infraestrutura aprovada, com conexão privada, credenciais gerenciadas e migrations controladas. O bootstrap local não deve ser usado em staging ou produção.
