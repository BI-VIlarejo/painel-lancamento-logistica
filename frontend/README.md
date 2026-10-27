# Frontend do Portal de Logística

## Usar a API local

Por padrão, o frontend não entra na demonstração. Configure a API real em `.env.local`:

```dotenv
VITE_API_BASE_URL=/api/v1
VITE_API_PROXY_TARGET=http://127.0.0.1:8000
VITE_DEMO_MODE=false
```

Instale as dependências com Node.js 22 e rode o Vite:

```bash
npm ci
npm run dev
```

Abra `http://localhost:5173`. Para o portal completo com API e MySQL locais, use as instruções de [`../docs/rodar-localmente.md`](../docs/rodar-localmente.md).

## Publicar o portal operacional conectado à API de staging

Para o piloto real, publique a branch `staging` na Vercel com estas variáveis no ambiente **Preview**:

```dotenv
VITE_API_BASE_URL=/api/v1
VITE_DEMO_MODE=false
```

O [`vercel.json`](./vercel.json) encaminha `/api/v1/*` para `https://api-bi.vilarejosolucoes.com.br/logistica-staging/api/v1/*`. Assim, o portal usa a API e o banco de staging. Depois do deploy, valide login, sessão e uma operação controlada no navegador. A origem exata do deployment precisa estar autorizada em `CORS_ALLOWED_ORIGINS` na API.

Não use a prévia demonstrativa abaixo para lançamentos operacionais: ela grava apenas no navegador e não chama a API.

## Demonstração opcional

O modo fictício inicia quando `VITE_DEMO_MODE=true`. Ele usa dados guardados no navegador e não chama a API, mesmo se `VITE_API_BASE_URL` estiver configurada. Para conectar ao backend, mantenha `VITE_DEMO_MODE=false`.

Para abrir a demonstração sem iniciar a API ou conectar a qualquer banco:

```bash
npm ci
npm run dev:demo
```

Abra `http://localhost:5173` e escolha **Entrar na demonstração**. Os registros demonstrativos ficam somente no armazenamento local desse navegador; eles não são enviados à API nem ao banco. Para apagar qualquer alteração feita nessa prévia, limpe os dados do site `localhost:5173` no navegador.

## Publicar uma prévia demonstrativa na Vercel

O repositório já contém `vercel.json` com `npm run build`, saída `dist` e fallback para as rotas do React. Ao importar o repositório na Vercel:

1. Configure `frontend/` como **Root Directory**.
2. Crie uma branch não produtiva, por exemplo `demo-diretor-logistica`, e conecte o repositório à Vercel.
3. Em **Settings → Environment Variables**, configure `VITE_DEMO_MODE=true` somente para **Preview**. Não configure `VITE_API_BASE_URL` para Preview; com a demonstração ativa, o frontend ignora essa URL e usa os dados fictícios do navegador.
4. Deixe `VITE_DEMO_MODE=false` em **Production**. Não promova a prévia nem faça merge dessa branch na branch de produção.
5. Envie a branch ao repositório conectado. A Vercel criará uma Preview com URL própria; compartilhe o link da branch para que os próximos pushes atualizem a mesma prévia.

Esse fluxo não inicia API nem acessa banco. As alterações de demonstração ficam no armazenamento do navegador de cada pessoa. Use somente dados fictícios. Previews ficam públicos por padrão, a menos que a proteção de deploy esteja ativada; se estiver protegida, compartilhe pelo recurso de acesso/Share da Vercel.
