# Painel de Entregas Vilarejo
**Especificação Técnica — Reconstrução e Evolução (para Codex / equipe dev)**

* **Versão da especificação:** 2.0
* **Data:** 20/10/2026
* **Produto:** Sistema web de controle de entregas e indicadores OTIF
* **Empresa:** Vilarejo (materiais de construção / acabamentos)
* **Objetivo deste documento:** Servir de blueprint técnico completo para reconstruir, auditar ou evoluir o sistema. Descreve arquitetura, modelo de dados, cada tela, cada funcionalidade, cálculos, integrações e regras de negócio no nível de implementação.

---

## 1. Resumo Executivo

O **Painel de Entregas Vilarejo** é um sistema gerencial de logística em página única (SPA) que substitui a planilha antiga "Controle de Retorno de Entregas". Centraliza:

* Lançamento de entregas realizadas e não realizadas por equipe (motorista + 2 entregadores);
* Registro de reclamações e elogios de clientes, com pontuação por pessoa;
* Cálculo do indicador **OTIF** (*On Time In Full*) nas visões: geral, por loja, por pessoa, por equipe e evolução mensal;
* Cadastro de lojas, entregadores e motivos de ocorrência;
* Painel gerencial com filtros combináveis e impressão em PDF padronizada;
* Modo multiusuário opcional via Firebase Realtime Database.

**Contexto de negócio:** A empresa historicamente registrava APENAS entregas com problema. O sistema passou a aceitar também entregas 100% realizadas para cálculo preciso do nível de atendimento.

---

## 2. Regras de Negócio (FONTE DA VERDADE)

### 2.1. Fórmula do OTIF

$$\text{OTIF \%} = \frac{\text{Entregas Realizadas}}{\text{Realizadas} + \text{Não Realizadas}} \times 100$$

**Faixas de cor:**
* $\text{OTIF} \ge 95\%$ -> **Verde** (`#16a34a`) — meta atingida
* $90\% \le \text{OTIF} < 95\%$ -> **Amarelo** (`#d97706`) — atenção
* $\text{OTIF} < 90\%$ -> **Vermelho** (`#dc2626`) — crítico

### 2.2. Atribuição integral por pessoa (CRÍTICA — regra do cliente)
Quando um lançamento cita Motorista, Entregador 1 e Entregador 2, **CADA um dos três recebe INTEGRALMENTE** as entregas daquele lançamento nas estatísticas pessoais.
* *Exemplo:* Vitor (motorista), Paulo (E1) e Antônio (E2) com 10 realizadas -> os três recebem 10 realizadas cada um.

### 2.3. Vários motivos por lançamento
* Cada entrega não realizada precisa de um motivo (motivo + quantidade).
* A **SOMA** das quantidades dos motivos **DEVE ser EXATAMENTE igual** ao total de "Entregas Não Realizadas".
* *Exemplo:* 2 não realizadas = 1 "Cliente ausente" + 1 "Avaria no produto".
* Validação inline bloqueia o salvamento se a soma não bater.

### 2.4. Pontuação de atendimento
* **Elogio** = $+1$ ponto por pessoa citada.
* **Reclamação** = $-1$ ponto por pessoa citada.
* **Score de Atendimento (Ranking)** = $\text{Elogios} - \text{Reclamações}$.

### 2.5. Regras Gerais de Dados
* **Auto-cadastro:** Nomes novos digitados em qualquer campo de pessoa (motorista, E1, E2) entram automaticamente na lista de entregadores ao salvar.
* **Histórico preservado:** Renomear/excluir loja, motivo ou pessoa **NUNCA** altera lançamentos antigos — eles guardam o texto como histórico.
* **Migração automática:** Registros salvos em versões antigas (campo único de pessoa e motivo único) são migrados ao abrir o sistema (ver seção 6.3).

---

## 3. Stack e Arquitetura

| Item | Definição |
| :--- | :--- |
| **Tipo** | SPA — UM único arquivo `index.html` autocontido (HTML + CSS + JS inline) |
| **Gráficos** | Chart.js via CDN: `https://cdn.jsdelivr.net/npm/chart.js` (versão 4.x) |
| **Persistência local** | `localStorage` do navegador (chaves separadas por domínio de dado) |
| **Multiusuário** | Firebase Realtime Database (SDK compat 9.x via CDN) |
| **SDK multiusuário** | `https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js` e `firebase-database-compat.js` |
| **Responsividade** | Sim — breakpoints mobile-first; lançamento em campo no celular |
| **Idioma** | `pt-BR`; números no formato brasileiro (ex.: `96,4%` — vírgula decimal) |

**Princípio de arquitetura:** Aplicação *offline-first*. Sem Firebase configurado, opera 100% local. Com Firebase, opera em tempo real com cache local (ver seção 16).

---

## 4. Design System e Identidade Visual

* **Header:** Logo oficial Vilarejo (imagem, altura `~44px`, largura `auto`, `border-radius` leve, `object-fit: contain`) + subtítulo "Controle de Entregas". Fallback via `onerror`: substituir por texto `"VILAREJO — Controle de Entregas"`.
* **Logo URL embutida no sistema (gerada/ajustada):**
  `https://generated-images.adapta.one/vypaes%40gmail.com/01a11c13-970b-74bb-b5a9-6b2b1ee95632/2026-10-08T19-07-56-284Z_Original_user_intent_Tool_generated_image_directi.png`
* **Paleta:** Azul-marinho escuro `#0F2A43` (header/navegação), acentos verde `#16a34a` e âmbar `#d97706`.
* **Cards:** Sombra suave (`box-shadow: 0 1px 3px rgba(0,0,0,.1)`), cantos arredondados (`border-radius: 12px`).
* **Tipografia:** `system-ui, -apple-system, "Segoe UI", Roboto, Inter, sans-serif`.
* **Estado vazio:** Quando não há dados, mostrar mensagem amigável + botão `"Carregar dados de exemplo"`.
* **Marca:** TODAS as menções usam `"VILAREJO"` / `"Vilarejo"` (nunca `"Vilarígio"`).

---

## 5. Estrutura Geral da Aplicação

### 5.1. Navegação — 5 abas (tabs no topo)
1. Lançamento de Entregas
2. Reclamações e Elogios
3. Cadastros
4. Painel Gerencial
5. Ranking de Pessoas

### 5.2. Estado global esperado
* Um objeto repositório carregado em memória e espelhado no `localStorage` (e no Firebase quando online).
* **Funções comuns:** `salvarEntregas()`, `salvarFeedbacks()`, `salvarCadastro(chave)`, `renderTabela()`, `popularSelects()`, `popularDatalists()`, `renderKPIs()`, `renderGraficos()`, `aplicarFiltros()`, `calcularOTIF(registros)`.
* Toda renderização de KPIs/gráficos/tabelas deve ser disparada após qualquer mudança de dados ou filtro (função central `atualizarTudo()`).

---

## 6. Modelo de Dados (`localStorage` e Firebase)

### 6.1. Chaves de `localStorage` (sugestão de nomes)

| Chave | Conteúdo |
| :--- | :--- |
| `vilarejo_entregas` | Array de lançamentos |
| `vilarejo_feedbacks` | Array de feedbacks (reclamações/elogios) |
| `vilarejo_lojas` | Array de nomes de lojas |
| `vilarejo_entregadores` | Array de nomes de pessoas |
| `vilarejo_motivos` | Array de nomes de motivos |
| `vilarejo_firebase_config` | Objeto de configuração do Firebase |

### 6.2. Formato dos registros (JSON)

**Lançamento de entrega:**
```json
{
  "id": "uuid",
  "data": "2026-10-20",
  "loja": "MACAÉ",
  "motorista": "Vitor",
  "entregador1": "Paulo",
  "entregador2": "Antônio",
  "realizadas": 10,
  "nao_realizadas": 2,
  "ocorrencias": [
    { "motivo": "Cliente ausente", "quantidade": 1 },
    { "motivo": "Avaria no produto", "quantidade": 1 }
  ],
  "observacoes": "texto livre"
}
```

**Feedback (reclamação/elogio):**
```json
{
  "id": "uuid",
  "data": "2026-10-20",
  "tipo": "RECLAMACAO | ELOGIO",
  "cliente": "Nome do cliente",
  "loja": "CABO FRIO",
  "motorista": "Vitor",
  "entregador1": "Paulo",
  "entregador2": "",
  "descricao": "texto do ocorrido"
}
```

**Cadastro (lojas / entregadores / motivos):**
* **Lojas:** `["MACAÉ", "CABO FRIO", "CAMPOS"]`
* **Entregadores:** `["Vitor", "Paulo", "Antônio"]`
* **Motivos:** `["Cliente ausente", "Endereço incorreto", "Cliente desistiu", "Avaria no produto", "Erro de separação", "Veículo quebrado", "Recusa do cliente", "Área de risco", "Outro"]`

### 6.3. Migração de registros legados (executar no load)
* Registro antigo com campo único `motorista` (string) -> mapear para `motorista`; `entregador1` e `entregador2` = `""`.
* Registro antigo com `motivo` único (string) -> converter em `ocorrencias: [{ motivo, quantidade: nao_realizadas }]`.
* Manter `id` se existir; gerar `id` via `crypto.randomUUID()` quando ausente.

### 6.4. Nós Firebase (modo online)
* `/entregas` (chave: `id` do lançamento)
* `/feedbacks` (chave: `id` do feedback)
* `/lojas`, `/entregadores`, `/motivos` (listas)

---

## 7. Aba 1 — Lançamento de Entregas (frontend)

### 7.1. Formulário

| Campo | Tipo HTML | Obrigatório | Comportamento |
| :--- | :--- | :---: | :--- |
| **Data** | `input type="date"` | SIM | Padrão = hoje |
| **Loja** | `select` | SIM | Populado de `vilarejo_lojas` |
| **Motorista** | `input text` + `datalist` | SIM | Sugestões de `vilarejo_entregadores`; nome novo -> auto-cadastro |
| **Entregador 1** | `input text` + `datalist` | NÃO | Idem |
| **Entregador 2** | `input text` + `datalist` | NÃO | Idem |
| **Entregas Realizadas** | `input type="number" min="0"` | SIM | Inteiro |
| **Entregas Não Realizadas** | `input type="number" min="0"` | SIM | Inteiro |
| **Motivos (bloco dinâmico)** | Linhas `select` (motivo) + `input number` (quantidade) | CONDICIONAL | Visível apenas quando $\text{Não Realizadas} > 0$ |
| **Observações** | `textarea` | NÃO | Livre |

### 7.2. Bloco dinâmico de motivos
* Ao digitar `"Não Realizadas"`: $N$, renderizar 1 linha com `quantidade` = $N$.
* Botão `"+ Adicionar motivo"` -> nova linha (`select` vazio, quantidade mínima 1).
* Cada linha extra tem botão remover; mínimo 1 linha.
* `onChange` de qualquer linha: recalcular máquina de validação.
* **Validação:** `soma(quantidade dos motivos) === nao_realizadas`. Se diferente -> mensagem inline vermelha + bloqueio do botão salvar.

### 7.3. Tabela de lançamentos
* **Colunas:** Data | Loja | Motorista | Entregador 1 | Entregador 2 | Realizadas | Não Realizadas | Motivos (formato `"Motivo:Qtd | Motivo:Qtd"`) | Observações | Ação (excluir).
* **Ordenação:** Data decrescente (mais recente primeiro).
* Excluir com `confirm()`.

### 7.4. Exportar/Importar CSV
* **Exportar colunas (cabeçalho exato):** `data,loja,motorista,entregador1,entregador2,realizadas,nao_realizadas,motivos,observacoes`
* `motivos` codificado como `"Motivo:Qtd | Motivo:Qtd"`.
* **Importar:** Aceitar o formato exportado E o legado (motivo único sem quantidade -> `quantidade = nao_realizadas`). Escapar vírgulas com aspas; usar `Blob` + `URL.createObjectURL` para download e `input type="file"` para upload.

---

## 8. Aba 2 — Reclamações e Elogios (frontend)

### 8.1. Formulário

| Campo | Tipo | Obrigatório |
| :--- | :--- | :---: |
| **Data** | `date` | SIM |
| **Tipo** | `select` (Reclamação / Elogio) | SIM |
| **Cliente** | `text` | SIM |
| **Loja** | `select` (de `vilarejo_lojas`) | SIM |
| **Motorista** | `text` + `datalist` | SIM |
| **Entregador 1** | `text` + `datalist` | NÃO |
| **Entregador 2** | `text` + `datalist` | NÃO |
| **Descrição do ocorrido** | `textarea` | SIM |

### 8.2. Pontuação e exibição
* **Badge:** Vermelho `"Reclamação (-1)"` / Verde `"Elogio (+1)"`.
* Cada pessoa preenchida recebe o ponto; alimenta o Ranking.
* Tabela com botão excluir por linha; botão Exportar CSV próprio (mesmas colunas do formulário).

---

## 9. Aba 3 — Cadastros (frontend)

### 9.1. Três blocos gerenciáveis (mesmo padrão de componente)
Cada bloco: `input` + botão `"Adicionar"` -> lista com ações **editar** (renomear inline, substituindo o texto do item) e **excluir** (com confirmação). Persistência imediata na chave correspondente.

* **Lojas** — padrão inicial: `MACAÉ`, `CABO FRIO`, `CAMPOS`.
* **Entregadores** — inicia vazio; auto-cadastro de nomes novos (regra 2.5).
* **Motivos** — padrão inicial listado em 6.2.

> **Regra:** `selects` de loja e motivo e `datalists` de pessoas em TODAS as abas são populados dinamicamente a partir destas listas (nunca valores *hardcoded*).

### 9.2. Card "Configurações — Modo Multiusuário" (no final da aba)
* **Badge de status:** 🟢 `"Modo online (multiusuário)"` / ⚪ `"Modo local (neste navegador)"`.
* **Campos:** `apiKey`, `authDomain`, `databaseURL`, `projectId` + botões **Conectar** / **Desconectar** (desconectar volta ao modo local sem apagar dados).
* Config salva em `vilarejo_firebase_config`.
* Falha de inicialização -> mensagem amigável + permanece em modo local (`try/catch`).
* **Guia recolhível "Como ativar — passo a passo":**
  1. Conta gratuita em `console.firebase.google.com`;
  2. Criar projeto;
  3. App web e copiar chaves;
  4. Ativar Realtime Database em modo de teste;
  5. Colar chaves e Conectar.
  * *Nota:* Em modo online, todos os usuários do link veem os mesmos dados em tempo real.

---

## 10. Aba 4 — Painel Gerencial (frontend)

### 10.1. Barra de filtros (todos combináveis entre si)

| Filtro | Comportamento |
| :--- | :--- |
| **Data início / Data fim** | Recorte por período |
| **Mês de referência (rápido)** | `input type="month"` + botão `"Limpar"`. Ao escolher, preenche automaticamente Data início = 1º dia e Data fim = último dia do mês; exibe mês no cabeçalho de impressão (ex.: `"Outubro/2026"`) |
| **Loja** | `"Todas"` ou específica |
| **Motivo** | `"Todos"` ou específico — lançamento entra se `ocorrencias` contém o motivo |
| **Pessoa** | `"Todas"` ou pessoa — lançamento entra se a pessoa aparece em motorista/E1/E2 |
| **Equipe** | `"Todas"` ou combinação EXATA das três pessoas (ex.: `"Vitor + Paulo + Antônio"`) |

*Filtros aplicados devem aparecer no cabeçalho da impressão.*

### 10.2. Cards de KPI (grade responsiva)
* **Total Planejadas** | **Realizadas** | **Não Realizadas** | **OTIF Geral %** (destaque, cor por faixa) | **Nível de Atendimento %** | **Reclamações** | **Elogios**
* *Nível de Atendimento* = mesma base do OTIF (pode ser exibido como sinonímia operacional do OTIF).

### 10.3. Gráficos (Chart.js) — dados preparados a partir do recorte filtrado
1. **OTIF % por Loja** — `bar`; adicionar linha/annotation de meta em 95% (ou segunda escala com linha tracejada).
2. **OTIF % por Pessoa** — `horizontalBar` (`indexAxis: 'y'`, agrega as 3 funções).
3. **Não realizadas por Tipo de Ocorrência** — `bar`; somar `quantidade` de cada motivo (NÃO contar 1 por lançamento).
4. **Evolução mensal do OTIF %** — `line`; agrupar lançamentos por `YYYY-MM` (ordenado), calcular OTIF por mês.
5. **Realizadas vs Não realizadas** — `doughnut`.

> **Regra de gráficos:** Quando um recorte não tem dados, exibir estado `"sem dados"` no card (não quebrar o Chart.js — destruir instância prévia com `chart.destroy()` antes de recriar).

### 10.4. Tabelas resumo
* **Por Loja:** Loja | Planejadas | Realizadas | Não Realizadas | OTIF %.
* **Por Equipe:** Equipe (combinação exata) | Planejadas | Realizadas | Não Realizadas | OTIF %, ordenada por volume de entregas decrescente.

---

## 11. Aba 5 — Ranking de Pessoas (frontend)

| Coluna | Origem |
| :--- | :--- |
| **Pessoa** | Nome (das 3 funções) |
| **Entregas Realizadas** | Soma de todos os lançamentos em que aparece em qualquer função |
| **Não Realizadas** | Idem |
| **OTIF %** | $\text{Realizado} / (\text{Realizado} + \text{Não Realizado})$ |
| **Elogios** | Contagem de feedbacks `ELOGIO` em que aparece |
| **Reclamações** | Contagem de feedbacks `RECLAMACAO` em que aparece |
| **Score** | $\text{Elogios} - \text{Reclamações}$ (verde $\ge 0$ destacado / vermelho $< 0$) |

* **Ordenação:** 1º OTIF desc, 2º Score desc.
* **Destaques:** Badge 🏆 `"Destaque"` no primeiro; destaque visual (cinza/vermelho) no último.
* **Barra de progresso do OTIF** ao lado de cada pessoa (largura % = OTIF, cor por faixa).
* Sem dados para a pessoa -> `"—"`.

---

## 12. Cálculos e Agregações (pseudocódigo para implementação)

```javascript
function calcularOTIF(realizadas, naoRealizadas) {
  const total = realizadas + naoRealizadas;
  if (total === 0) return null; // exibe "—"
  return (realizadas / total) * 100;
}

function agregarPorPessoa(registros) {
  const map = {};
  for (const r of registros) {
    for (const nome of [r.motorista, r.entregador1, r.entregador2]) {
      if (!nome) continue;
      if (!map[nome]) {
        map[nome] = { realizadas: 0, naoRealizadas: 0, ocorrencias: {} };
      }
      map[nome].realizadas += r.realizadas;
      map[nome].naoRealizadas += r.nao_realizadas;
      for (const oc of r.ocorrencias) {
        map[nome].ocorrencias[oc.motivo] = (map[nome].ocorrencias[oc.motivo] || 0) + oc.quantidade;
      }
    }
  }
  return map;
}

function agregarPorEquipe(registros) {
  const map = {};
  for (const r of registros) {
    const chave = [r.motorista, r.entregador1, r.entregador2].filter(Boolean).join(" + ");
    if (!map[chave]) {
      map[chave] = { realizadas: 0, naoRealizadas: 0 };
    }
    map[chave].realizadas += r.realizadas;
    map[chave].naoRealizadas += r.nao_realizadas;
  }
  return map;
}

function agregarPorMes(registros) {
  const map = {};
  for (const r of registros) {
    const mes = r.data.slice(0, 7); // "YYYY-MM"
    if (!map[mes]) {
      map[mes] = { realizadas: 0, naoRealizadas: 0 };
    }
    map[mes].realizadas += r.realizadas;
    map[mes].naoRealizadas += r.nao_realizadas;
  }
  return map; // ordenar pelas chaves antes de plotar
}
```

---

## 13. Lógica Combinada de Filtros

* **Pipeline único:**
  ```javascript
  registrosFiltrados = registros.filter(r =>
    passaPeriodo(r) &&
    passaMes(r) &&
    passaLoja(r) &&
    passaMotivo(r) &&
    passaPessoa(r) &&
    passaEquipe(r)
  );
  ```
* `passaPeriodo`: `r.data >= inicio && r.data <= fim` (quando definidos).
* `passaMes`: redundante com período (o filtro mês preenche o período — implementar assim para manter o estado dos inputs coerentes).
* `passaMotivo`: `filtro == "todos" || r.ocorrencias.some(oc => oc.motivo === filtro)`.
* `passaPessoa`: `filtro == "todas" || [r.motorista, r.entregador1, r.entregador2].includes(filtro)`.
* `passaEquipe`: `filtro == "todas" || chaveEquipe(r) === filtro`.
* **TODOS** os KPIs, gráficos, tabelas e o ranking respeitam o mesmo recorte filtrado (exceto o Ranking, que por padrão usa o conjunto completo da aba, podendo aplicar os mesmos filtros de período/loja se desejado — decisão de UX a documentar).

---

## 14. Impressão em PDF (todas as abas)

Cada aba tem botão `"Imprimir / PDF"` que aciona `window.print()`.

### 14.1. Regras comuns (`CSS @media print`)
* Imprimir **SOMENTE** o conteúdo da aba ativa (esconder as demais seções).
* **Ocultar:** menu de abas, formulários, botões de ação (adicionar/excluir/importar/exportar), barra de filtros, rodapé `"Apagar todos os dados"`.
* **Cabeçalho da impressão (todas as páginas):** logo Vilarejo + título da tela + filtros aplicados (período, loja, motivo, pessoa, equipe, mês) + data/hora de geração (`pt-BR`, ex.: `"20/10/2026 09:30"`).
* **Bloco de assinatura (fim de cada impressão):** linha `"Assinatura do Gestor: ______________"` + campos lado a lado `"Nome: ________"` e `"Data: ____/____/____"`, com `~60px` de espaço para assinatura à mão.
* **Rodapé:** `"Vilarejo — Controle de Entregas"`.

### 14.2. Orientação por tela

| Tela | Orientação |
| :--- | :--- |
| **Painel Gerencial** | `@page { size: A4 landscape; }` |
| **Lançamento** | `A4 portrait` |
| **Reclamações e Elogios** | `A4 portrait` |
| **Ranking** | `A4 portrait` |
| **Cadastros** | `A4 portrait` |

### 14.3. Gráficos no papel (imprescindível)
Antes de imprimir, substituir cada `canvas` do Chart.js por `<img src="canvas.toDataURL('image/png')">` (evento `beforeprint`) e restaurar no `afterprint`. Garantir resolução nítida (usar o próprio canvas; em telas HiDPI considerar escala 2x).

---

## 15. CSV — Formato Detalhado

**Arquivo de exportação de entregas:**
```csv
data,loja,motorista,entregador1,entregador2,realizadas,nao_realizadas,motivos,observacoes
2026-10-20,MACAÉ,Vitor,Paulo,Antônio,10,2,"Cliente ausente:1 | Avaria no produto:1",cliente pediu novo horário
2026-10-19,CABO FRIO,Paulo,,,7,0,,
```

**Arquivo de exportação de feedbacks:**
```csv
data,tipo,cliente,loja,motorista,entregador1,entregador2,descricao
```

* **Regras:** Separador vírgula; campos com vírgula entre aspas duplas; codificação UTF-8 (com BOM se necessário para Excel); `datalist` e `selects` nunca alteram o dado importado.

---

## 16. Modo Multiusuário — Firebase (implementação detalhada)

* **Inicialização:** `firebase.initializeApp(config)` após `"Conectar"`; `firebase.database()`.
* **Status:** Consultar `databaseURL`/ping ou listener de conexão (`.info/connected`) para alternar badge 🟢/⚪ e bandeira `"Reconectando..."`.
* **Seed na primeira conexão:**
  1. Ler `/entregas` e `/feedbacks` remotos (uma vez).
  2. Se remoto vazio E local com dados -> `set()` dos dados locais no Firebase (escrita única).
  3. Se remoto com dados -> substituir a visão local pela remota (sincronizar também `lojas`/`entregadores`/`motivos` se remoto tiver; senão enviar listas locais).
* **Sincronização contínua:** `ref.on("value", snapshot => { atualizar estado + re-render })` para `/entregas`, `/feedbacks`, `/lojas`, `/entregadores`, `/motivos`.
* **Escritas:** Ao salvar em modo online, `push()`/`set()` no nó correto (`id` do registro como chave) e espelhar no cache local `localStorage`; em modo local, somente `localStorage`.
* **Offline:** Listener `.info/connected` falso -> aviso discreto `"Reconectando..."` e lançamento local continua permitido (fila simples: tentar reenvio do registro pendente no `value` seguinte — decisão de implementação documentada: na v1, reenviar lançamentos locais não presentes no remoto ao reconectar).
* **Desconectar:** `firebase.app().delete()` + limpar flag; dados locais permanecem.

---

## 17. Dados de Exemplo (botão "Carregar dados de exemplo")

* ~60 lançamentos nos últimos 4 meses, distribuídos entre `MACAÉ`, `CABO FRIO`, `CAMPOS`.
* 5–6 pessoas nos papéis de motorista/E1/E2 (alguns lançamentos só com motorista; outros com equipe completa).
* Vários lançamentos com 2+ não realizadas e motivos distintos com quantidades (ex.: 1 cliente ausente + 1 avaria).
* 4 reclamações e 3 elogios vinculados às mesmas pessoas.
* Botão exibido apenas no estado vazio (ou com confirmação para substituir dados existentes).

---

## 18. Fluxos de Uso (para QA/testes)

1. Cadastrar loja/entregador/motivo novos -> confirmar que `selects`/`datalists` atualizam sem recarregar.
2. Lançar entrega com equipe completa e 2 motivos -> conferir somatório no dashboard e no ranking (3 pessoas pontuadas).
3. Lançar entrega 100% realizada (não realizadas = 0) -> bloco de motivos oculto; OTIF impacta positivamente.
4. Registrar elogio e reclamação -> conferir score no ranking.
5. Filtrar por mês -> período preenchido automaticamente; imprimir -> cabeçalho mostra `"Outubro/2026"`.
6. Exportar CSV -> importar em outra aba/PC -> dados idênticos.
7. Imprimir painel -> gráficos aparecem como imagens nítidas, paisagem A4, com assinatura no fim.

---

## 19. Checklist de Qualidade (para Codex)

- [ ] Zero menções a `"Vilarígio"`; usar sempre `"Vilarejo"`.
- [ ] Fórmula OTIF correta inclusive com divisão por zero -> `"—"`.
- [ ] Soma dos motivos validada no nível de formulário.
- [ ] Agregação por pessoa cobre as 3 funções com atribuição integral.
- [ ] Filtros combináveis sem conflito de estado (mês $\leftrightarrow$ período).
- [ ] Gráficos recriados com `destroy()` antes de re-render (sem vazamento de instâncias).
- [ ] Impressão por aba com conversão `canvas` -> `img`.
- [ ] Migração de registros legados no load.
- [ ] Firebase: padrão seed único (não duplicar dados na reconexão).
- [ ] Responsivo: formulário utilizável em tela `360px`.

---

## 20. Roadmap Sugerido (próximas evoluções)

1. Meta de OTIF configurável por loja (substituir 95% fixo).
2. Exportação mensal no formato da planilha original do Google.
3. Upload de foto da ocorrência (avaria) no lançamento.
4. Controle de acesso/roles (gestor vs operador).
5. Backup automático dos dados locais (exportação agendada manual).
6. Relatório mensal gerado em PDF (resumo + ranking + assinatura).
7. Dark mode e PWA (instalável no celular com offline).