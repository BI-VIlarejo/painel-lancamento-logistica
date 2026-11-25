# Vilarejo · Controle do Ônibus — protótipo

Protótipo funcional para controlar o uso do ônibus de funcionários por reconhecimento facial.
Publicado para teste em: https://controle-onibus-vyctor.vercel.app (projeto Vercel `controle-onibus`, time Vyctor).

> **Status:** protótipo validado em iPhone/Safari. **Não tem backend:** todos os dados ficam no `localStorage` do aparelho.
> O próximo passo é levar os dados para o Supabase (proposta em `supabase-schema.sql`).

---

## 1. Arquivos

| Arquivo | O que é |
|---|---|
| `index.html` | A aplicação inteira: HTML, CSS e JavaScript num único arquivo, sem build. |
| `supabase-schema.sql` | Proposta de tabelas, índices e RLS para a versão com banco. |
| `README.md` | Este documento. |

Para rodar localmente basta servir a pasta por HTTPS ou `localhost` (a câmera exige contexto seguro):

```bash
npx serve .        # ou: python3 -m http.server 8080
```

Abrir `http://localhost:3000` (ou 8080). No celular use um túnel HTTPS (ex.: `ngrok`, `cloudflared`) ou faça deploy na Vercel.

## 2. Dependências (via CDN, sem npm)

- **@vladmandic/face-api 1.7.13**: detecção e reconhecimento facial no navegador (TensorFlow.js).
  - Modelos carregados de `cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model/`: `tinyFaceDetector`, `faceLandmark68Net`, `faceRecognitionNet`.
  - Cada rosto vira um **descritor de 128 números**. A comparação é pela distância euclidiana. Limite padrão: `0.5`, ajustável em Ajustes ("Rigor").
- **Leaflet 1.9.4** + tiles OpenStreetMap: mapa de trajetos.
- **Google Fonts**: Inter / Inter Tight.

Sugestão para produção: hospedar os modelos no próprio domínio, para não depender do jsDelivr.

## 3. Telas e fluxo

### Terminal (celular fixo no ônibus), tela inicial

O terminal funciona como uma máquina de estados baseada em "existe viagem ativa?".

1. **Sem viagem ativa → tela do motorista**
   - O círculo central mostra "Motorista: toque aqui para iniciar seu turno".
   - Ao tocar, abre a câmera (`openScan('start')`). Só aceita cadastros com `role = 'motorista'`.
   - Se reconhecer, cria a viagem (`startTrip`) e mostra "Turno liberado" com o botão "Abrir tela dos funcionários".
2. **Com viagem ativa → tela dos funcionários**
   - O círculo mostra "Toque aqui para registrar seu acesso" (`openScan('pass')`). Só aceita `role = 'func'`.
   - 1º reconhecimento na viagem → **embarque** ("Viagem liberada").
   - Próximo reconhecimento da mesma pessoa → **desembarque** ("Desembarque liberado").
   - Rosto desconhecido → "Viagem não liberada" (fica registrado em `denied`).
   - Cadastro bloqueado → "Acesso não liberado".
3. **Botão "Encerrar turno"** (topo, só com viagem ativa) → `openScan('end')`.
   - O motorista confirma.
   - Quem ainda estiver a bordo é desembarcado automaticamente (`outMode = 'fim da viagem'`).
   - Aparece o resumo, com o botão de enviar no WhatsApp.

**Regras da câmera:**
- Abre só no toque e fecha após o resultado.
- Tempo máximo de leitura: 12 s.
- Exige 2 leituras seguidas do mesmo rosto para confirmar.
- O stream fica vivo por mais 30 s depois de fechar (para não pedir permissão de novo a cada pessoa) e depois é desligado.

**Intervalo anti-duplicidade:** `cfg.cool` segundos (padrão 10) por pessoa.

**Som:** bipe em WAV gerado no código (toca mesmo no modo silencioso do iPhone) mais voz via `speechSynthesis` em pt-BR. O áudio é destravado no toque do usuário (`unlockAudio`), exigência do iOS.

**GPS:** `watchPosition` contínuo. Durante a viagem grava um ponto a cada ≥25 m (ou a cada 2 min parado), ignora precisão pior que 60 m e soma os km por Haversine (`onPos`). Também pede para a tela não apagar (`navigator.wakeLock`).

### Gestão (engrenagem no canto; senha opcional em Ajustes)

| Aba | Conteúdo |
|---|---|
| **Painel** | Viagem atual, a bordo agora, KPIs do dia, embarques por hora, feed de eventos. Atualiza a cada 30 s e via evento `storage`. |
| **Relatórios** | Filtros: período (hoje, ontem, 7 d, 30 d, mês, datas livres), funcionário e motorista. Tabela por viagem (motorista, início, fim, km, nº de passageiros, nomes) e uso por funcionário. Imprimir/PDF (`window.print` + `@media print`) e CSV (`;`, UTF-8 com BOM, para abrir no Excel). |
| **Localização** | Mapa da viagem com o trajeto do GPS e os pontos de subida (verde) e descida (vermelho). |
| **Cadastros** | Funcionários e motoristas: nome, matrícula, setor, situação, 3 fotos do rosto (câmera ou upload). |
| **Ajustes** | Intervalo, WhatsApp de destino, senha, rota, regra "só embarca com turno iniciado", permitir face duplicada (**modo teste: desligar em produção**), voz, rigor, simulador, dados de exemplo, backup/restauração JSON. |

### Relatório pelo WhatsApp

`waText(trip)` monta um texto simples, sem localização: rota, nº da viagem, data, motorista, início/fim, duração, km, nomes dos passageiros e total.
O envio abre `https://wa.me/<numero>?text=...`. O motorista ainda precisa tocar em "Enviar" no WhatsApp. **Envio automático exige a WhatsApp Business API** (Cloud API da Meta, Z-API, Twilio etc.) chamada pelo backend.

## 4. Modelo de dados atual (localStorage, chave `controle_onibus_v1`)

```js
{
  users:  [{ id, role:'func'|'motorista', name, mat, setor, active:boolean,
             descs: number[128][],  // 1 a 3 descritores faciais
             photo: 'data:image/jpeg;base64,...', created }],
  trips:  [{ id, n /*nº do dia*/, route, driverId, start, end|null,
             startLoc, endLoc, endBy:'motorista'|'gestão',
             track: [[lat,lng,timestamp], ...], dist /*metros*/ }],
  rides:  [{ id, userId, tripId, inAt, inLoc, outAt|null, outLoc,
             outMode:'face'|'fim da viagem' }],
  denied: [{ id, at, loc, userId|null, reason }],
  cfg:    { th, cool, voice, route, pin, wa, needDriver, allowDup }
}
// loc = { lat, lng, acc }   timestamps em ms (Date.now())
```

## 5. Próximos passos sugeridos (produção)

1. **Supabase:**
   - Criar as tabelas de `supabase-schema.sql`.
   - Trocar `load()` e `save()` por chamadas ao `supabase-js`. Hoje toda escrita passa por `save()`, o que facilita: separar em inserts e updates pontuais (`startTrip`, `endTrip`, `register`, `blocked`, `denyUnknown`, `onPos`).
2. **Tempo real:** a gestão assina `postgres_changes` em `rides`, `trips` e `denied` (Supabase Realtime), substituindo o evento `storage`.
3. **Autenticação:**
   - Gestão com login (Supabase Auth).
   - Terminal com um usuário de serviço por ônibus (`device_id`) e RLS limitando o que ele pode gravar.
4. **Fotos e descritores:**
   - Fotos no Supabase Storage (bucket privado).
   - Descritores em `face_descriptors` (coluna `vector(128)` com pgvector ou `float4[]`).
   - O terminal baixa os descritores dos cadastros ativos ao iniciar e guarda em cache para funcionar sem sinal.
5. **Offline:** o ônibus vai perder sinal. Manter uma fila local (IndexedDB) de eventos e sincronizar quando voltar a conexão.
6. **Prova de vida (anti-foto):** hoje uma foto impressa ou na tela de outro celular pode passar. Opções: pedir piscada ou virar o rosto (landmarks), ou usar um SDK comercial de liveness.
7. **Desligar o modo teste:** `allowDup = false` e remover "Simular leitura" e "Gerar dados de exemplo".
8. **LGPD:** biometria é dado pessoal sensível. É preciso termo de consentimento do funcionário, finalidade definida, política de retenção e exclusão, e acesso restrito aos descritores e fotos.
9. **Multi-ônibus:** adicionar a tabela `buses` e `bus_id` nas viagens (já previsto no schema).
10. **WhatsApp automático:** Edge Function no Supabase disparada no fim da viagem, chamando a API de WhatsApp escolhida.

## 6. Limitações conhecidas do protótipo

- Dados só no aparelho: apagar os dados do Safari apaga tudo. Use o backup JSON em Ajustes.
- O rastreio GPS só funciona com a tela ligada e a página em primeiro plano, por limitação do iOS para páginas web. Para rastreio em segundo plano, o caminho é um app nativo ou PWA com app companion.
- O reconhecimento roda no próprio celular. Em aparelhos antigos a leitura pode levar 1–2 s.
- Testado em iPhone/Safari. Em Android/Chrome deve funcionar, mas não foi validado.
