# Planejamento — Aba RH e Aplicativo de Controle de Ônibus

**Registrado em:** 25/11/2026  
**Status:** **Aguardando envio dos arquivos do aplicativo pelo diretor.**  
**Regra de execução:** **Não criar setor/aba `RH`, rotas, tabelas, migrations ou telas no Portal antes de receber e analisar os arquivos do aplicativo enviados pelo diretor.**

---

## 1. Contexto da demanda

O diretor criou, com apoio de IA, um aplicativo de celular para controle de ônibus corporativo e enviará os arquivos do projeto para evolução e integração com o Portal de Lançamento.

O pedido reúne duas frentes conectadas:

1. **Melhorar o aplicativo mobile** (qualidade de código, fluxo operacional, estabilidade, segurança e usabilidade), mantendo nele **somente o uso de campo** (cadastro e rotinas do motorista e dos passageiros).
2. **Adicionar uma nova aba `RH` no Portal de Lançamento**, concentrando toda a **visão gerencial e administrativa** que hoje eventualmente exista ou precise existir para acompanhar o aplicativo.

---

## 2. Separação de responsabilidades (App Mobile vs. Portal Web)

### 2.1 Aplicativo Mobile (somente operação de motorista e passageiro)

O aplicativo deve ficar focado exclusivamente na ponta operacional durante a rotina das viagens:

- Cadastro e rotinas estritamente ligadas ao **motorista** e ao **passageiro**.
- **Ponto do motorista:** registro que identifica qual motorista está conduzindo o ônibus em cada viagem/turno.
- **Controle de embarque:** registro dos passageiros que embarcam/desembarcam no ônibus.
- **Execução da viagem:** abertura/fechamento da viagem, horário real e contagem de passageiros a bordo.
- **Fora do aplicativo:** remover ou migrar para o Portal qualquer painel gerencial, relatório administrativo ou tela de gestão que não pertença à rotina do motorista/passageiro.

### 2.2 Portal de Lançamento — Aba `RH` (visão gerencial)

A aba **RH** no site será o ponto central para o diretor e perfis autorizados acompanharem a operação do ônibus em tempo real e histórico:

- **Monitoramento de viagens em andamento e realizadas:** identificar quem é o motorista da viagem, qual o horário/rota/turno e status da viagem.
- **Monitoramento de ocupação e embarques:** acompanhar quem está no ônibus, quantos passageiros embarcaram e em qual viagem/horário.
- **Gestão e administração centralizada:** consultas, filtros, histórico, indicadores gerenciais e cadastros administrativos que saírem do aplicativo mobile (conforme o que for identificado nos arquivos enviados).
- **Controle de acesso:** respeitar autenticação, permissões e escopos do Portal, garantindo que a aba `RH` seja visível apenas para perfis autorizados (ex.: Diretoria, RH e perfis de gestão definidos).

---

## 3. O que analisar assim que o diretor enviar os arquivos

Antes de propor o desenho técnico definitivo ou iniciar alterações, revisar os arquivos recebidos cobrindo:

1. **Stack e estrutura do aplicativo:** tecnologia usada (React Native/Expo, Flutter, PWA, Android nativo, HTML/JS empacotado, etc.), dependências, forma de build/distribuição e armazenamento atual de dados (local, Firebase, Supabase, API própria, etc.).
2. **Fluxos atuais implementados:** telas de cadastro, fluxo de ponto do motorista, mecanismo de embarque de passageiros (QR code, crachá, matrícula, lista manual, etc.) e o que hoje está na parte gerencial do app e deverá migrar para o site.
3. **Qualidade, segurança e confiabilidade:** vulnerabilidades, credenciais hardcoded, validações ausentes, riscos de perda de dados e comportamento com sinal de internet instável/offline durante o trajeto do ônibus.
4. **Modelo de dados:** entidades reais (ônibus/veículos, rotas/linhas, turnos/horários, viagens, motoristas, registros de ponto, passageiros, embarques) para mapear tabelas tipadas e versionadas via cadeia Alembic em `VilarejoBI` sem quebrar os módulos existentes.

---

## 4. Decisões para alinhar após o recebimento dos arquivos

- **Backend e persistência:** confirmar se o aplicativo mobile passará a gravar diretamente na API FastAPI do `LancamentoLogistica` (mesmo banco operacional) ou via camada dedicada, e como funcionará a autenticação no celular (token/sessão mobile segura, sem expor credenciais no app).
- **Funcionamento offline:** definir se motoristas precisam registrar ponto/embarque sem internet durante o trajeto com sincronização posterior e idempotência.
- **Identificação de passageiros e LGPD:** definir quais dados pessoais de colaboradores/passageiros são estritamente necessários, prazo de retenção e restrição de visualização/exportação na aba `RH`.
- **Perfis e permissões da aba `RH`:** definir se haverá um novo setor `RH` no controle de escopos, novas permissões específicas (visualização, gestão, exportação, cadastros) e quais perfis existentes (`DIRETORIA`, `DEV`, `GESTOR`, novo perfil de RH) terão acesso.
- **Indicadores e exportações gerenciais:** confirmar métricas prioritárias (ocupação por viagem/horário, frequência, pontualidade, histórico por motorista/passageiro) e se haverá exportação em planilha/relatório.

---

## 5. Ordem prevista de execução (somente após receber os arquivos)

1. Receber e auditar os arquivos do aplicativo enviado pelo diretor.
2. Consolidar a especificação técnica (telas do app vs. telas da aba `RH`, contrato de API, permissões e modelo de banco).
3. Criar/validar migrations aditivas (via `VilarejoBI`) e endpoints no backend com testes.
4. Refatorar e melhorar o aplicativo mobile, removendo a parte gerencial e conectando à API segura.
5. Implementar a aba `RH` no frontend do Portal seguindo os padrões visuais e de autorização do projeto.
6. Validar ponta a ponta em staging antes de qualquer publicação em produção.
