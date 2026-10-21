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

## Demonstração opcional

O modo fictício só inicia quando `VITE_DEMO_MODE=true` e `VITE_API_BASE_URL` não está configurada. Ele usa dados guardados no navegador e não chama a API. Para testar o site real, mantenha `VITE_DEMO_MODE=false`.

Para abrir a demonstração sem iniciar a API ou conectar a qualquer banco:

```bash
npm ci
npm run dev:demo
```

Abra `http://localhost:5173` e escolha **Entrar na demonstração**. Os registros demonstrativos ficam somente no armazenamento local desse navegador; eles não são enviados à API nem ao banco. Para apagar qualquer alteração feita nessa prévia, limpe os dados do site `localhost:5173` no navegador.
