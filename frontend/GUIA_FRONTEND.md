# Guia do frontend

Este documento explica como o frontend do Portal de Logística está organizado, o papel dos principais arquivos e onde procurar para alterar cada parte. O código da aplicação fica em `frontend/src`.

## Visão geral

O frontend usa React e TypeScript. Os arquivos `.tsx` descrevem telas e componentes; os arquivos `.module.css` definem os estilos locais desses componentes. As chamadas ao backend ficam em módulos `api.ts`, e os arquivos `types.ts` descrevem o formato dos dados.

```text
index.html
└── src/main.tsx
    └── src/app/App.tsx
        ├── autenticação e permissões
        ├── seleção da tela pela rota
        └── AppShell (estrutura comum)
            └── página da funcionalidade
                └── API da funcionalidade
                    └── cliente HTTP compartilhado
```

As rotas da aplicação são `/login`, `/redefinir-senha`, `/entregas`, `/historico`, `/feedback`, `/painel` e `/cadastros`. Um endereço `/entregas/{id}` abre a edição de um rascunho; `/trocar-senha` permite alterar a senha opcionalmente após autenticação. As telas autenticadas são exibidas dentro da estrutura comum do `AppShell`.

## Inicialização, autenticação e rotas

- `src/main.tsx` — ponto de entrada do React. Importa o CSS global, encontra o elemento `#root` definido em `index.html` e renderiza `<App />` dentro de `StrictMode`.
- `src/app/App.tsx` — coordena o aplicativo. Lê a sessão e as permissões, escolhe qual página renderizar, redireciona caminhos desconhecidos e mostra uma mensagem quando a pessoa não tem acesso. Também define as condições de acesso às rotas existentes.
- `src/app/App.module.css` — estilos locais dos estados tratados pelo `App`, como carregamento e acesso indisponível.
- `src/app/router.tsx` — navegação interna simples baseada na History API do navegador. Atualiza a URL e informa os componentes quando o caminho muda, sem recarregar a página inteira.
- `src/app/providers.tsx` — mantém o estado de autenticação compartilhado: carrega a sessão ao iniciar, disponibiliza usuário e permissões e expõe as ações de login e logout por meio de `AuthProvider` e `useAuth`.
- `src/app/layout/AppShell.tsx` — estrutura comum das páginas autenticadas. Monta a barra lateral, navegação agrupada, cabeçalho, identificação do usuário e ação de sair. Filtra itens de menu pelas permissões e controla o menu em telas menores.
- `src/app/layout/AppShell.module.css` — aparência da estrutura autenticada, incluindo menu, cabeçalho, estados ativos e adaptação para dispositivos menores.

As permissões verificadas no frontend controlam o que aparece na navegação e quais telas são exibidas. O backend também precisa validar as permissões ao receber cada requisição; esconder um botão no frontend não substitui a validação do servidor.

## Login

- `src/features/auth/pages/LoginPage.tsx` — tela de login. Controla os campos, o envio das credenciais, estados de carregamento e mensagens de erro. Pode mostrar a opção de demonstração quando o modo demo está ativo.
- `src/features/auth/pages/LoginPage.module.css` — estilos exclusivos da tela de login.
- `src/features/auth/pages/ChangePasswordPage.tsx` — alteração opcional da própria senha.
- `src/features/auth/pages/ResetPasswordPage.tsx` — redefinição local com nome completo, username e senha nova; não oferece criação pública de conta.
- `src/features/auth/pages/ChangePasswordPage.module.css` — estilos próprios da troca de senha.
- `src/features/auth/api.ts` — operações de autenticação com a API: consultar identidade, entrar, trocar ou redefinir senha, renovar o token CSRF e sair. Encaminha o modo demo quando ele está ativo.
- `src/features/auth/types.ts` — tipos TypeScript para usuário autenticado, permissões e respostas de login e identidade.

## Entregas

### Lançamento

- `src/features/deliveries/pages/DeliveryLaunchPage.tsx` — coordena a tela de lançamento. Carrega listas de apoio e, ao editar, busca os dados do rascunho para preencher o formulário.
- `src/features/deliveries/pages/DeliveryLaunchPage.module.css` — estilos próprios da página de lançamento.
- `src/features/deliveries/components/DeliveryForm.tsx` — formulário de lançamento. Mantém os valores dos campos, valida os dados, monta o envio e trata criação ou edição. Inclui o fluxo de salvar como rascunho e revisar e lançar, sem depender de uma segunda pessoa para aprovar.
- `src/features/deliveries/components/DeliveryForm.module.css` — estilos e regras responsivas do formulário.

### Histórico e importação CSV

- `src/features/deliveries/pages/DeliveryHistoryPage.tsx` — página do histórico. Gerencia filtros, paginação, visualização de detalhes, ações permitidas para rascunhos e exportação CSV. Também abre a janela de importação.
- `src/features/deliveries/pages/DeliveryHistoryPage.module.css` — estilos do histórico, filtros, tabela e elementos relacionados.
- `src/features/deliveries/components/DeliveryCsvImportDialog.tsx` — janela de importação. Lê o arquivo CSV, oferece um modelo, confere os dados e mostra problemas antes de enviar os lançamentos.
- `src/features/deliveries/components/DeliveryCsvImportDialog.module.css` — estilos da janela de importação e da prévia dos dados.

### API e tipos de entregas

- `src/features/deliveries/api.ts` — chamadas à API para listar e consultar lançamentos, criar ou atualizar rascunhos e confirmar lançamentos. Monta parâmetros de busca e seleciona a API demo quando aplicável.
- `src/features/deliveries/types.ts` — formatos TypeScript para entregas, status, filtros, catálogos e dados enviados ou recebidos pela API.
- `src/features/deliveries/demoApi.ts` — implementação fictícia das operações de entrega para testar o frontend sem backend. Usa dados de exemplo e armazenamento local do navegador; não representa os dados reais da empresa.

## Painel gerencial

- `src/features/analytics/pages/ManagementDashboardPage.tsx` — monta o painel, controla filtros, carrega os indicadores e apresenta resumos, gráficos e tabelas de desempenho por localidade, motivo, equipe e pessoa.
- `src/features/analytics/pages/ManagementDashboardPage.module.css` — estilos próprios e responsivos do painel.
- `src/features/analytics/api.ts` — consulta o endpoint de indicadores do backend e envia os filtros selecionados.
- `src/features/analytics/types.ts` — define os formatos de resposta dos indicadores, incluindo resumos, tendências, localidades, motivos, equipes e pessoas.

A visão por pessoa está dentro do painel e funciona como uma tabela de ranking; não há uma página de ranking separada no momento.

## Reclamações e elogios

- `src/features/feedback/pages/FeedbackPage.tsx` — registra elogios e reclamações, carrega lojas e equipe, filtra o histórico, mostra detalhes e exporta os resultados visíveis em CSV.
- `src/features/feedback/pages/FeedbackPage.module.css` — estilos e adaptações responsivas da página e dos diálogos de cadastro e detalhe.
- `src/features/feedback/api.ts` — contrato de leitura e gravação em `/feedbacks`; usa a API de prévia quando o modo de demonstração está explicitamente ativado.
- `src/features/feedback/demoApi.ts` — permite experimentar o fluxo no modo de prévia, mantendo registros no armazenamento local do navegador.
- `src/features/feedback/types.ts` — formatos dos registros, participantes e dados enviados no cadastro.

A tela fica no grupo **Relacionamento** da barra lateral. O frontend usa `FEEDBACK_CLIENTES:ACESSAR` para exibir a rota e separa `FEEDBACK_CLIENTES:VER`, `FEEDBACK_CLIENTES:CRIAR` e `FEEDBACK_CLIENTES:EXPORTAR` para consultar, cadastrar e exportar. Relatos e nomes de clientes são tratados como informação restrita.

## Catálogos

- `src/features/catalogs/api.ts` — carrega catálogos ativos usados nos formulários de operação.
- `src/features/administration/pages/RegistriesPage.tsx` — área administrativa para lojas, motoristas/ajudantes, motivos de não entrega e contas de funcionários. Inclui busca, filtros de situação, cadastro/versionamento e concessão de perfis com escopos.
- `src/features/administration/pages/RegistriesPage.module.css` — layout, tabelas, navegação interna, formulários, drawer de acessos e adaptações responsivas da administração.
- `src/features/administration/api.ts` — consultas e alterações dos cadastros, provisionamento de contas, concessões/revogações de escopo e consultas de perfil.
- `src/features/administration/types.ts` — tipos de lojas, pessoas, motivos, contas, perfis e concessões de acesso.
- `src/features/administration/demoApi.ts` — dados fictícios em memória para visualizar e interagir com a tela no modo demonstração.

O menu mostra “Cadastros e acessos” somente para quem tem `CADASTROS:ADMINISTRAR` ou `CONTROLE_ACESSO:ADMINISTRAR`. A criação de conta continua restrita à administração; o login não tem auto cadastro. No formulário de criação, a administração escolhe o perfil e o escopo iniciais; backend grava a conta e a primeira concessão na mesma transação. Perfil define ações e escopo define em quais setores/lojas elas valem. A lista de perfis que cada administrador pode conceder respeita seu nível; somente `DEV` global pode conceder `DEV` ou alterar as definições de perfis e permissões. Os acessos começam sem data final e podem ser revogados pela administração.

## Comunicação com o backend

- `src/shared/api/apiClient.ts` — cliente HTTP compartilhado. Centraliza a URL base, requisições, cookies, token CSRF, timeout e configuração do modo demo. As APIs das funcionalidades usam esse cliente.
- `src/shared/api/apiError.ts` — padroniza erros da API, transforma códigos HTTP em mensagens para a interface e organiza erros de validação por campo.

## Componentes e estilos compartilhados

- `src/shared/components/BrandMark.tsx` — exibe a marca do Vilarejo e o nome “Vilarejo Logística”. O componente importa `frontend/logo-vilarejo.png`.
- `src/shared/components/BrandMark.module.css` — aparência e dimensões do componente de marca.
- `src/shared/components/FeedbackMessage.tsx` — arquivo reservado a um componente compartilhado de mensagens. No estado atual, não contém uma implementação de componente em uso.
- `src/shared/components/LoadingState.tsx` — arquivo reservado a um componente compartilhado de carregamento. No estado atual, não contém uma implementação de componente em uso.
- `src/shared/styles/classNames.ts` — utilitário `cx` para combinar classes dos módulos CSS e estilos compartilhados.
- `src/shared/styles/common.module.css` — padrões reutilizados pelas telas: botões, filtros, avisos, modais, estados vazios, indicadores de carregamento e outras estruturas comuns.
- `src/styles/global.css` — estilos que valem para o aplicativo inteiro: fonte, cores e variáveis do tema, reset básico, tipografia padrão e foco dos elementos.
- `src/vite-env.d.ts` — declara ao TypeScript as variáveis de ambiente do Vite aceitas pelo frontend, como `VITE_API_BASE_URL` e `VITE_DEMO_MODE`.

## Arquivos de configuração e recursos

- `index.html` — documento HTML que hospeda a aplicação React e define o elemento `#root`.
- `package.json` — lista dependências e comandos, como `npm run dev`, `npm run build` e `npm run typecheck`.
- `package-lock.json` — fixa as versões resolvidas das dependências para instalações reproduzíveis. Normalmente é atualizado junto com mudanças de dependências.
- `vite.config.ts` — configura o Vite, o plugin React, a porta de desenvolvimento e o proxy das chamadas `/api` para o backend.
- `tsconfig.json` — configuração principal do TypeScript e referências para as configurações específicas.
- `tsconfig.app.json` — opções de verificação TypeScript para o código do aplicativo.
- `tsconfig.node.json` — opções de verificação TypeScript para arquivos de configuração executados no Node, como `vite.config.ts`.
- `Dockerfile.dev` — define a imagem Docker usada para rodar o frontend em desenvolvimento.
- `vercel.json` — configura build e roteamento para hospedagem na Vercel, incluindo o fallback de rotas da aplicação.
- `README.md` — instruções de instalação, execução local e uso do modo de demonstração do frontend.
- `logo-vilarejo.png` — imagem de marca usada por `BrandMark.tsx`.
- `logo-vilarejo.svg` — versão SVG alternativa da marca; não é a imagem importada atualmente pelo componente `BrandMark`.

## Funcionalidades sem página própria

A administração de perfis, recursos e permissões detalhadas continua na API; a página atual associa perfis já configurados a usuários. O módulo de feedback do backend ainda precisa implementar e registrar as rotas de leitura e gravação antes de a tela funcionar em modo conectado ao banco. O modo de prévia serve para validar o fluxo visual e funcional no navegador; os registros ficam somente naquele navegador.

## Onde alterar cada coisa

| Quero alterar… | Começo por… |
| --- | --- |
| Cores, fontes ou estilos globais | `src/styles/global.css` |
| Estilo de uma tela ou componente | O `.module.css` ao lado do `.tsx` correspondente |
| Menu lateral, grupos ou cabeçalho autenticado | `src/app/layout/AppShell.tsx` e `AppShell.module.css` |
| Caminhos e seleção das páginas | `src/app/router.tsx` e `src/app/App.tsx` |
| Login e estado da sessão | `src/features/auth/` e `src/app/providers.tsx` |
| Campos ou validação do lançamento | `src/features/deliveries/components/DeliveryForm.tsx` |
| Histórico, filtros ou CSV | `src/features/deliveries/pages/DeliveryHistoryPage.tsx` e `DeliveryCsvImportDialog.tsx` |
| Indicadores e visualizações do painel | `src/features/analytics/pages/ManagementDashboardPage.tsx` |
| Endpoints ou formato dos dados | O `api.ts` e o `types.ts` da funcionalidade correspondente |
| Requisições comuns ou tratamento geral de erros | `src/shared/api/` |

## Arquivos gerados e dependências

`frontend/node_modules` contém dependências instaladas pelo npm. `frontend/dist` contém os arquivos gerados pelo build de produção. Não são fontes da aplicação e não devem ser editados manualmente; as alterações devem ser feitas nos arquivos de `src` e nas configurações correspondentes.
