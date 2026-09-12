# Mapa completo de funcionalidades — GrafPro

> Levantado em 2026-09-11, lendo o código real de cada rota (page.tsx +
> actions.ts + componentes client relevantes), não memória de conversa —
> pedido do dono pra ter uma referência do que o site faz hoje, ponta a
> ponta. Não é doc de arquitetura de schema (isso é `arquitetura-resumo.md`)
> nem de pendências (isso é `visao-admin.md`) — é "o que cada tela faz e que
> regra de negócio governa ela". Vai ficar desatualizado conforme o sistema
> evolui; se for usado como base de pesquisa (ex: por um Opus estrategista
> numa rodada futura), vale conferir contra o código antes de assumir que um
> detalhe específico ainda é verdade.

## Índice

1. [Autenticação / Onboarding](#1-autenticação--onboarding)
2. [Orçamento](#2-orçamento)
3. [Portal público do cliente](#3-portal-público-do-cliente)
4. [Catálogo](#4-catálogo)
5. [Compras](#5-compras)
6. [Produção](#6-produção)
7. [Financeiro](#7-financeiro)
8. [Clientes](#8-clientes)
9. [Configurações](#9-configurações)
10. [Usuários / Permissões](#10-usuários--permissões)
11. [Meu Negócio / Relatórios](#11-meu-negócio--relatórios)
12. [Importação](#12-importação)
13. [Administração da plataforma / Ajuda / Landing](#13-administração-da-plataforma--ajuda--landing)

---

## 1. Autenticação / Onboarding

### `/login`
E-mail + senha + Cloudflare Turnstile (anti-bot). Mensagem de erro genérica
("e-mail ou senha inválidos") em qualquer caso, com hash "fantasma"
verificado quando o e-mail não existe, para não vazar por timing se a conta
existe. Rate-limit por e-mail+IP. Usuário desativado é barrado no login (não
só depois).

### `/registro`
Cadastro self-service de uma nova gráfica: cria `Grafica` +
`AssinaturaGrafica` (status TRIALING, trial começa a contar do cadastro, não
do primeiro acesso a Configurações) + `Usuario` papel DONO, numa transação.
Honeypot anti-bot, rate-limit por IP, exige aceite de Termos/Privacidade. Se
um e-mail nunca verificado ficar "abandonado" por mais de 24h, a gráfica é
apagada em cascata e o e-mail liberado para novo cadastro. Redireciona para
`/verificar-email`.

### `/esqueci-senha`
Solicita e-mail; sempre responde a mesma mensagem genérica (exista ou não o
e-mail) para evitar enumeração de contas — inclusive o tempo de resposta é
igual nos dois casos (envio de e-mail via `after()`, fora do tempo de
resposta). Token de reset válido por 1 hora.

### `/redefinir-senha?token=...`
Sem token na URL, mostra erro pedindo para solicitar um novo link. Com
token, formulário de nova senha.

### `/verificar-email`
Exibida a usuário autenticado mas com e-mail ainda não verificado; envia
código de 6 dígitos. Verificação com limite de 5 tentativas (reservadas
atomicamente no banco para evitar força bruta paralela); reenvio de código é
rate-limited e sempre espera o envio de verdade terminar (diferente do
cadastro) para avisar se falhou. Sucesso redireciona para `/bem-vindo`.

### `/bem-vindo`
Tela de boas-vindas pós-verificação, com CTA "Vamos começar"
(`/comecar?tour=1`) ou "Pular" (`/comecar`).

### `/comecar` (checklist de onboarding)
Barra de progresso com até 3 passos monitorados (tem cliente, tem catálogo,
tem orçamento). Inclui formulário inline pra cadastrar o primeiro cliente,
atalhos para Catálogo, Configurações (parâmetros de precificação, opcional)
e Orçamento. Painel para carregar/gerenciar dados de exemplo (avisa se falta
configurar o segmento da gráfica antes). Suporta modo "tour" guiado
(`?tour=1`, componente client-only carregado sob demanda).

---

## 2. Orçamento

### `/orcamento` (lista + calculadora)
Tela dupla: se o usuário pode editar orçamentos, mostra a "Calculadora de
orçamento" (form `CalculadoraForm` para montar um orçamento novo); se só
pode ver, mostra apenas a lista.

- Calculadora carrega: itens vendáveis (com preço de venda definido),
  acabamentos disponíveis, matérias-primas candidatas a "papel" (usadas pelo
  motor de clichê de etiqueta), até 200 clientes ativos (`{id, nome}`
  apenas — nunca CPF/CNPJ/endereço no payload), filiais ativas (só aparecem
  se a gráfica tiver alguma cadastrada) e vendedores elegíveis (cargo
  Vendedor ou DONO/ADMIN).
- Banner de alerta "N orçamentos parados" (status `ENVIADO`, sem resposta há
  N+ dias — configurável em `ParametrosGrafica.diasAlertaOrcamentoParado`,
  padrão 5 dias) com link para `/orcamento/parados`.
- Se a gráfica não tem cliente ou item vendável cadastrado, mostra CTA
  "Continuar configuração" em vez da calculadora (onboarding incompleto).
- Lista "Orçamentos recentes" (10 últimos, mais recente primeiro): cliente,
  itens, total, status (badge), e botão "Marcar como enviado" para
  rascunhos.
- **Ações**: `precificarItem` (prévia de preço de um item sem persistir,
  usada pelo carrinho antes de adicionar); `buscarCondicoesComerciaisCliente`
  (pré-preenche "condições de pagamento" a partir do prazo/forma preferida
  do cliente, só quando ele é selecionado); `criarOrcamento` (cria o
  orçamento com N itens de uma vez, a partir de um "carrinho" JSON).
- **Regras de negócio**:
  - Todo preço é **recalculado no servidor**, nunca confia no valor do
    carrinho vindo do client.
  - Cada item pode usar um motor de precificação diferente conforme o
    produto: SIMPLES, M2, OFFSET, FLEXOGRAFIA, DIGITAL, SERIGRAFIA,
    SUBLIMACAO, ESTAMPAGEM_QUENTE, PERSONALIZACAO, REVENDA, BORDADO,
    TEMPO_MAQUINA, DTF, EDITORIAL, CHAPA_RIGIDA (motor chamado via
    `calcularItemOrcamento`, fórmulas não detalhadas aqui).
  - Cliente com `margemPadraoOverride` sobrepõe a margem padrão da gráfica
    em todo item do orçamento.
  - "Piso do pedido" (`ParametrosGrafica.pedidoMinimo`) é aplicado **uma
    única vez sobre a soma** dos itens, nunca por item.
  - Item M2 sempre ganha uma linha de `OrcamentoItemEtiqueta` (mesmo
    vazia) — nunca existe "M2 sem etiqueta".
  - Item sem preço de venda cadastrado bloqueia com mensagem específica
    (distinta de "produto não encontrado").
  - Ao salvar, dispara `updateTag` de uso mensal (billing) e redireciona
    para o detalhe; se for o primeiro orçamento da gráfica, acrescenta
    `?primeiro=1` para disparar a celebração.

### `/orcamento/parados`
Lista todo orçamento `ENVIADO` sem resposta (`respostaPublicaEm` null) há
N+ dias, ordenado do mais parado para o mais recente. Cada linha mostra
cliente, vendedor, total, "X dias parado" e um botão "Cobrar no WhatsApp"
com mensagem pré-formatada, ou "Sem telefone" se o cliente não tiver
telefone cadastrado. Puramente informativo/cobrança — nenhuma ação de
mudança de status aqui.

### `/orcamento/[id]` (detalhe — tela central do módulo)
- Cabeçalho: cliente (trocável só em RASCUNHO), data de criação, quem
  aprovou/recusou pelo link público (nome **declarado, não verificado**),
  status badge.
- Card "Dados do pedido" (`editarDadosGeraisOrcamento`): vendedor (texto ou
  usuário real vinculado), tipo de pedido, número do pedido do cliente,
  contato, condições de pagamento, frete, transportadora, valor do frete,
  local de entrega, nota de empenho/processo licitatório, observações.
  **Editável a qualquer status** (não trava em RASCUNHO) — esses campos não
  mexem em preço nem no que o cliente já viu.
- Cronograma de entrega contratual (`entrega-programada.ts`): até N linhas
  de quantidade+data+local, a soma não pode ultrapassar a quantidade total
  do orçamento; puramente declarativo — nunca gera `Entrega`/`ContaReceber`,
  nunca muda status de pedido.
- Card "Arte do orçamento" (só em RASCUNHO): upload de arte de cabeçalho —
  PDF/JPG/PNG validados por assinatura de bytes (não só Content-Type), com
  preflight automático (avisos de dimensão) e cota de armazenamento
  reservada antes do upload.
- **Em RASCUNHO**: cada item é totalmente editável (`editarOrcamento`),
  com:
  - Desconto negociado por item (`aplicarDescontoItemOrcamento`): tipo
    PERCENTUAL, VALOR_ABSOLUTO ou PRECO_FINAL, sempre calculado sobre
    `precoSugeridoUnitario` (baseline fixa do motor, nunca sobre o preço
    atual já descontado). Duas travas inegociáveis: (1) preço negociado
    nunca pode ficar abaixo do custo direto do item; (2) desconto acima do
    limite de alçada do usuário (`resolverLimiteDesconto` — alçada
    individual > alçada do papel > DONO/ADMIN sem teto/OPERADOR travado no
    limite global) é recusado; acima do limite global (mas dentro da
    alçada) grava `aprovadoPorId`.
  - Editar quantidade/medida do item **sempre limpa o desconto negociado**
    (preço recalculado do zero).
  - Faixas de quantidade alternativas por item (`faixas.ts`, até N):
    tabela comparativa de tiragens recalculada pelo mesmo motor de preço; é
    só exibição comparativa, **nunca** muda `Orcamento.total` — precisa ser
    promovida manualmente se o cliente escolher outra faixa.
  - Medidor de margem estimada por item e agregada (só visível em
    RASCUNHO).
  - Análise de tinta por IA: estimativa de gasto de tinta a partir de foto
    da arte, recurso **pago** (plano Pro/Empresarial), puramente
    informativo, com rate limit.
  - Arte por item (`ArteItem`, arte.ts): upload de arte individual por
    item de orçamento, independente da arte de cabeçalho; versiona a cada
    reenvio; pode ser aprovada depois pelo link público mesmo antes de
    virar Pedido.
  - "+ Adicionar item" e remover item (bloqueado se for o último item —
    precisa cancelar o orçamento inteiro).
- **Fora de RASCUNHO**: itens ficam somente-leitura, com resumo técnico
  completo (dimensões, cores, acabamentos, etiqueta, faixas).
- Opções alternativas (`opcoes.ts`): até N "Opção B/C..." com carrinho
  próprio, cada uma recalculada e com piso de pedido aplicado; só existem em
  RASCUNHO/ENVIADO; descartadas automaticamente ao aprovar (a escolhida vira
  o orçamento, as demais somem) ou rejeitar.
- Compartilhamento (`ciclo-vida.ts`): gera link público `/o/[token]` (token
  só é criado uma vez, reaproveitado); gerar o link a partir de RASCUNHO
  **transiciona automaticamente para ENVIADO** (define validade padrão da
  gráfica, `enviadoEm`, tolerância de tiragem); revogar gera um token novo;
  renovar validade só empurra `validoAteEm`.
- Pagamentos (`pagamentos.ts`): só registrável com orçamento `APROVADO`;
  reconciliação automática com Conta a Receber — se o valor bate exato com
  uma parcela PENDENTE (ou fecha o saldo remanescente de uma PARCIAL), marca
  ela como recebida junto.
- Emissão de NF-e (`nfe.ts`): via Focus NFe com token da própria gráfica;
  bifurca campos fiscais conforme regime tributário; bloqueada se faltar
  dado fiscal obrigatório; nota REJEITADA/DENEGADA pode ser reemitida; ao
  autorizar, gera Contas a Receber se a condição de pagamento usar âncora de
  "emissão de nota".
- Etapas de produção (comerciais): 5 marcos (desenvolvimento, layout,
  aprovação, confirmação de pedido, entrega) com data/hora + responsável
  texto livre, editável a qualquer status, sem gate.
- **Ações do rodapé (`status.ts`)** — transição via `atualizarStatusOrcamento`:
  - Fluxo: `RASCUNHO → ENVIADO → APROVADO | REJEITADO`; `ENVIADO →
    RASCUNHO` (reabertura via "solicitar ajuste" do cliente); sempre com
    compare-and-swap.
  - **Ao aprovar**: escolhe a opção vencedora e promove seu total; gera
    Contas a Receber; cria/faz upsert de `Pedido` (status inicial `ARTE`);
    vincula toda `ArteItem` pendente ao pedido; abre o apontamento inicial
    da etapa; grava snapshot de custo previsto por categoria; candidata
    itens OFFSET pequenos a "gang run"; calcula e grava comissão do
    vendedor (`resolverDadosComissao` — regra por especificidade, depois
    `Usuario.comissaoPercent`, depois fallback de representante sem
    cadastro); opcionalmente lança a comissão como custo do pedido; permite
    abater saldo de crédito adiantado do cliente (falha a operação inteira
    se o saldo não cobrir); verifica bloqueio de venda/faturamento e
    estouro de limite de crédito; notifica por e-mail o responsável por
    nota fiscal.
  - **Ao rejeitar**: descarta as opções alternativas.
  - **Ao marcar `ENVIADO`**: grava validade, `enviadoEm`, tolerância de
    tiragem padrão.
  - Cancelar: só em RASCUNHO; **hard delete**, remove arquivos órfãos do
    blob.
  - Duplicar / "Pedir de novo": só a partir de APROVADO/REJEITADO; cria
    orçamento novo em RASCUNHO, preço **sempre recalculado do zero**;
    desconto herdado (mesmo percentual efetivo, sujeito às mesmas travas);
    nunca copia status/link/resposta/validade/etapas/arte/análise de tinta.

---

## 3. Portal público do cliente

### `/o/[token]` — aprovação do orçamento (sem login)
Acesso só pelo token; mostra dados do pedido, cronograma de entrega, itens
(com faixas alternativas), arte, total, "Baixar PDF" (`/o/[token]/pdf`). Com
opções alternativas, exibe abas por opção. **Nunca** expõe `breakdown`
(custo/margem). Se `APROVADO`, mostra dados de pagamento (PIX/bancários)
informativos. Vencido mostra aviso de expiração.

**Ações**: aprovar/recusar (nome declarado obrigatório, motivo opcional só
na recusa; rate limit por IP+orçamento; checagem de assinatura ativa da
gráfica — bloqueia resposta se a assinatura não está ativa). Aprovação pelo
cliente dispara **o mesmo fluxo transacional** da aprovação interna
(`origemConfirmacao: "LINK_PUBLICO"`). "Solicitar ajuste": reabre o
orçamento para `RASCUNHO`, notifica vendedor/donos — não gera Pedido nem
Comissão.

### `/a/[token]` — aprovação de arte (sem login, vinculado ao Pedido)
Token é `Pedido.arteLinkToken`. Mostra arte de cabeçalho e uma seção por
item com arte própria, decisão independente. **Ações**: aprovar ou pedir
alteração (comentário obrigatório), nome declarado, CAS evita dupla
resposta, rate limit, mesma checagem de assinatura ativa. Aprovar não muda
status do pedido automaticamente — só sinaliza (`arteAprovadaEm`) pro fluxo
de produção.

### `/p/[token]` — confirmação de etapa de produção por link (sem login)
Token é `Pedido.producaoLinkToken`; mostra etapa atual e, se atribuível, um
botão de confirmação. `ARTE`/`CLICHE_FACA` (baixa estoque, exige tela
própria) e estados terminais ficam de fora de propósito. Trava anti-e-mail-
antigo: grava a etapa vista no carregamento (`etapaEsperada`); se o pedido
já mudou de status, rejeita. Rate limit por IP; avança via
`avancarStatusPedido` (mesmo motor do painel interno), sem operador/máquina.

### `/q/[token]` — QR code de etiqueta física (sem login, mobile-first)
Token é `Pedido.qrToken`; pra ser escaneada na etiqueta física colada no
produto. Mostra cliente, itens, etapa atual, botão único pra avançar pra
**próxima** etapa. Deliberadamente mais permissiva que `/p/[token]`: sem
rate limit por IP (mesma etiqueta reescaneada várias vezes) e sem
`etapaEsperada`. `FILA` fica de fora do avanço de um clique (mesma razão de
`CLICHE_FACA`); `origemConfirmacao: "QR_ETIQUETA"`.

---

## 4. Catálogo

### `/catalogo`
Lista mestre global de itens (`ItemCatalogo`, `graficaId=null`) mais itens
privados da gráfica, em 3 abas — Produtos, Matérias-primas, Serviços —
agrupados por categoria. Marcar um item como "selecionado" cria/ativa um
`ItemGrafica`; desmarcar desativa (nunca apaga).

- Ações: marcar/desmarcar individual ou em lote; preencher preço de
  compra/venda; para matéria-prima, editar estoque atual/mínimo/perda fixa
  inline; "Aplicar preço a todos selecionados sem preço" (nunca sobrescreve
  valor já digitado); cadastro de item novo inline (sempre privado da
  gráfica); para matéria-prima nova, cadastro inline de variantes.
- Salvar (`salvarCatalogo`) é "salva tudo de uma vez": valida preço/estoque
  não-negativo; compare-and-swap no "estoque atual" (baixa concorrente da
  produção é respeitada); editar estoque aqui gera `AJUSTE_INVENTARIO` no
  histórico; toda mudança é auditada; mudança de preço de COMPRA carimba
  `precoCompraAtualizadoEm`.
- Badges de alerta por item: "Pendência", "Preço desatualizado", "Lote
  vencendo" (só depois do onboarding inicial).
- Card "Previsão de estoque" (crítico dispara e-mail aos DONOs) linka
  `/catalogo/estoque`. Card "Reajuste de preços em lote" linka
  `/catalogo/reajuste`.

### `/catalogo/[itemGraficaId]`
Configuração avançada de UM item — muda de layout por tipo.

- **PRODUTO**: NCM/origem (fiscal); modelo de cálculo (SIMPLES, M2, OFFSET,
  FLEXOGRAFIA, DIGITAL, SERIGRAFIA, SUBLIMACAO, ESTAMPAGEM_QUENTE,
  PERSONALIZACAO, REVENDA, BORDADO, TEMPO_MAQUINA, DTF, EDITORIAL,
  CHAPA_RIGIDA) — cada motor com seu próprio conjunto de campos de custo
  (substrato, máquina/prensa vinculada com aviso de manutenção,
  bobinas/formatos, clichê, área mínima faturável); ficha técnica de
  consumo por variante; **estoque de produto pré-produzido** — fabricar
  especulativamente (sem pedido) consumindo a ficha técnica na hora, com
  histórico de movimentação de estoque pronto.
- **MATÉRIA-PRIMA**: categoria "Papéis" tem tabela gramatura×preço/kg;
  senão, gerenciador de variantes (rótulo/preço/estoque/mínimo/perda,
  upsert que nunca apaga variante referenciada); quantidade por embalagem;
  configuração de compra (unidade, fator de conversão, lote mínimo, múltiplo
  de compra); controle de lote/validade/certificação opt-in; lançamento
  manual de movimentação (Entrada de compra, Saída manual, Ajuste de
  inventário, Produção especulativa); histórico completo com autor, motivo,
  documento, lote, link pro pedido de origem.
- **SERVIÇO**: acabamento (base de cobrança: unidade/m²/folha/metro
  linear/fixo/hora; pré/pós-refile; custo de setup/mínimo/ferramental);
  acabamento estrutural (dobra/encadernação/colagem); ficha técnica de
  consumo próprio.
- Regra central: todo lançamento manual de estoque usa compare-and-swap
  contra concorrência com baixa automática de produção.

### `/catalogo/estoque`
Somente-leitura: "Previsão de estoque" a partir do consumo real dos últimos
60 dias. Por matéria-prima controlada: estoque atual, consumo médio diário,
data prevista de esgotamento, chip de urgência (Crítico ≤7d, Atenção ≤30d,
Tranquilo, Abaixo do mínimo, Sem dados).

### `/catalogo/reajuste`
Reajuste de preço de venda em lote. Percentual (-90% a +500%, não pode ser
zero) + filtro de categoria opcional; "Visualizar" recalcula prévia sempre
no servidor; "Aplicar" grava em transação. **Só afeta produtos SIMPLES**
(M2/OFFSET/demais motores derivam preço de custo+margem, não são tocados).
Respeita `incrementoArredondamento` do tenant. Um único log de auditoria por
lote inteiro.

**Estoque como conceito** (vive dentro de Catálogo, não é seção separada):
`MovimentacaoEstoque` com tipos ENTRADA_COMPRA, SAIDA_PRODUCAO (automática),
SAIDA_MANUAL, AJUSTE_INVENTARIO, ESTORNO_CANCELAMENTO, ENTRADA_PRODUCAO/
SAIDA_ATENDIMENTO_PEDIDO (estoque pré-produzido). Toda alteração manual
protegida por CAS. Alerta de estoque crítico dispara e-mail aos DONOS.

---

## 5. Compras

### `/compras`
Lista de solicitações por status: Solicitado → Cotando → Aprovado →
Comprado → Recebido (parcial/total) → Conferido (mais Cancelado). Cards
"Contratos esgotando" e "Sugestões por estoque baixo" (3 sinais: abaixo do
mínimo, abaixo do ponto de pedido — estoque de segurança + consumo médio ×
lead time —, ou dentro do limiar genérico configurável; só sugere itens sem
solicitação ativa em aberto). CTAs "Contratos de fornecimento" e "Nova
solicitação".

### `/compras/nova`
Nasce SOLICITADO, exceto origem `CONTRATO_PROGRAMADO` (nasce APROVADO,
pula cotação). Alvo: item de matéria-prima do catálogo e/ou descrição
livre — pelo menos um obrigatório. `tipoCompra`: só MATERIA_PRIMA com item
estruturado gera movimentação de estoque ao receber. Origem: Reposição de
estoque, Pedido específico (gera `CustoPedido` COMPRA ao receber),
Contrato programado (fornecedor/preço sempre copiados do contrato, revalida
servidor-side), Outro. Suporte a unidade de compra distinta da unidade de
estoque (conversão sempre recalculada no servidor). Comparativo de preços
por fornecedor + indicadores OTIF agregados. Se há contrato ativo cobrindo o
item, oferece aplicar direto.

### `/compras/[id]`
Detalhe/workflow: dados gerais, custo de aquisição real (frete/IPI/ICMS
creditável/desconto), fornecedor, nº da nota, quantidade recebida vs.
solicitada, linha do tempo, entradas de estoque geradas, cotações,
ações de transição/cancelamento.

- Transições (`TRANSICOES_VALIDAS`): SOLICITADO→{COTANDO, APROVADO,
  CANCELADO}; COTANDO→{APROVADO, CANCELADO}; APROVADO→{COMPRADO,
  CANCELADO}; COMPRADO→{RECEBIDO, CANCELADO}; RECEBIDO_PARCIAL→{RECEBIDO};
  RECEBIDO→{CONFERIDO}; CONFERIDO/CANCELADO finais.
- Cotações: editáveis só em SOLICITADO/COTANDO; a partir de APROVADO viram
  histórico. Uma vencedora por vez. COTANDO→APROVADO exige cotação
  vencedora escolhida (quando aplicável); aprovar via cotação sobrescreve
  fornecedor/valor estimado.
- **Alçada de aprovação por valor**: ao avançar para APROVADO, se o valor
  excede o limite do usuário (por papel ou individual), bloqueia — pede
  alguém com alçada maior.
- COMPRADO exige valor final pago > 0 — vira o "custo de aquisição real"
  snapshotado no estoque na chegada.
- **Recebimento parcial**: usuário informa quantidade recebida NESTA
  confirmação (incremento); sistema soma ao já recebido e decide
  RECEBIDO/RECEBIDO_PARCIAL; divergência exige observação obrigatória.
  Cada confirmação gera sua própria `MovimentacaoEstoque` (custo unitário
  constante, custo total prorateado). CAS contra o estoque atual. Item sem
  controle de estoque nunca "nasce" com saldo ao receber.
- `CustoPedido`/consumo de `ContratoFornecimento.quantidadeConsumida` só
  lançados no fechamento TOTAL, nunca em recebimentos parciais
  intermediários.

### `/compras/contratos` e `[id]`
Preço fixo negociado com fornecedor por vigência; solicitações vinculadas
nascem direto Aprovado. Contrato "coringa" (sem item específico) ou
vinculado a item/variante. Campos: fornecedor, item/variante opcional,
preço unitário, unidade, vigência início/fim, quantidade contratada
opcional, condição de pagamento, ativo/inativo. Quantidade contratada não
pode ser reduzida abaixo do já consumido. Card "Contratos esgotando".

---

## 6. Produção

### `/producao` (Fila de produção — Kanban/lista)
Tela central: todos os pedidos em produção, duas visualizações (Lista e
Kanban), filtro por cliente e período.

- Pedidos ativos primeiro (mais antigo → mais novo); Entregues/Cancelados
  separados no fim (mais recente → mais antigo).
- No Kanban, dentro de cada coluna: prioridade (Baixa/Normal/Alta/Urgente),
  depois prazo, depois criação; agrupados por máquina.
- Chips de estado: "Atrasado (Nd)", "No terceiro — retorna dd/mm", "Parado —
  motivo", "Aguardando aprovação de qualidade".
- Banner "N itens esperando gang run" → `/producao/gang-run`.
- Acesso: `PRODUCAO.podeVer`; operadores designados como responsáveis de
  uma etapa (`ResponsavelEstagio`) só veem os pedidos nessa(s) etapa(s).
  Valor/lucro só aparece com `CUSTOS.podeVer`.
- Ações por pedido:
  - **Avançar etapa** (`avancarStatusPedido`): botão principal, delega ao
    motor de transição. Canal APP permite escolher máquina e reportar
    refugo/quantidade boa.
  - **Confirmar impressão com baixa de estoque**: ao sair de Clichê/Faca
    pra Produção, painel de confirmação mostra cada matéria-prima
    consumida, perda fixa editável, custo estimado (com `CUSTOS.podeVer`).
    Itens com estoque pré-produzido suficiente podem ser atendidos direto
    do estoque (sem consumir matéria-prima).
  - **Cancelar pedido**: estorna estoque baixado, estorna `CustoPedido`
    automáticos, cancela contas a receber PENDENTES e comissão PENDENTE,
    remove de filas de gang run.
  - **Lançar/excluir custo real**: gate `CUSTOS.podeEditar` (separado de
    `PRODUCAO` — chão de fábrica pode lançar retrabalho sem ver margem).
  - **Enviar/remover arte**: só na etapa "Arte"; preflight de DPI/tamanho;
    zera aprovação anterior a cada reenvio; consome cota de armazenamento.
  - **Registrar aprovação de qualidade** (achado D1, 2026-09-11): tipos
    OK_MAQUINA, PROVA_CONTRATO, AMOSTRA_CLIENTE (registro interno, sem link
    público ainda), INSPECAO_PROCESSO, INSPECAO_FINAL, OUTRO; resultado
    APROVADO / APROVADO_COM_RESSALVA / REPROVADO; foto opcional; vinculada
    ao apontamento aberto da etapa atual.
  - **Terceirização**: envio a fornecedor, valor acordado, previsão de
    retorno, nota de remessa; estados AGUARDANDO_ENVIO → ENVIADO →
    RETORNADO (desvio PROBLEMA); pode emitir NF-e de remessa.
  - **Parada de pedido**: motivo (material, aprovação/arte do cliente,
    máquina parada, terceiro, falta de operador, outro), vínculo opcional
    com solicitação de compra; só uma parada ativa por vez (índice único).
  - **Entrega**: nasce AGUARDANDO; motorista opcional; estados AGUARDANDO →
    EM_TRANSITO → ENTREGUE (desvio PROBLEMA).

### Motor de transição de status (`status-transicao.ts`)
Núcleo compartilhado por avanço autenticado, confirmação pública sem login e
QR de chão de fábrica.

- **Gates opt-in** (só travam quem usa o recurso):
  1. Arte enviada precisa estar aprovada pelo cliente antes de sair de
     "Arte".
  2. Se usa arte por item, toda `ArteItem` precisa estar aprovada.
  3. Se a etapa de saída tem `exigeAprovacaoQualidade` ligado, precisa
     existir `AprovacaoProducao` com resultado que libere, amarrada à
     passagem ATUAL (retrabalho não herda aprovação de rodada anterior).
- Sequência de etapas configurável por gráfica (liga/desliga/renomeia/
  reordena); etapa desativada depois que o pedido chegou nela bloqueia com
  aviso.
- **Baixa automática de estoque**: dispara na entrada em "Produção" física.
  Desconta consumo + perda fixa (confirmada/editada pelo operador), gera
  `MovimentacaoEstoque` com snapshot de custo e lote/validade, cria
  `CustoPedido` (origem CONSUMO_ESTOQUE, desligável). Itens "atender do
  estoque pré-produzido" pulam consumo, geram SAIDA_ATENDIMENTO_PEDIDO.
- **Refugo opcional**: desconta proporcionalmente a matéria-prima do
  produto (não dos acabamentos), com validação linha a linha.
- Webhook de automação (`pedido_status_mudou`, `estoque_critico`) e e-mail
  aos responsáveis pela próxima etapa.
- Ao chegar em ENTREGUE, gera `ContaReceber` da condição de pagamento (se
  âncora de ENTREGA).
- Tudo protegido por CAS e transação Serializable quando mexe em estoque
  compartilhado.

### `/producao/gang-run`
Itens Offset (chapa/folha) ou Flexografia/grande formato (bobina) pequenos
demais para encher uma peça sozinhos, candidatados automaticamente na
aprovação. Agrupados por compatibilidade física, com barra de progresso de
% preenchido. Ação: selecionar 2+ candidatos do mesmo grupo e "Combinar e
mandar pra produção" — sistema nunca decide sozinho.

### `/producao/[pedidoId]/fechamento`
Acesso restrito a `CUSTOS.podeVer`. 4 blocos: **Venda** (sugerido x
negociado, erosão por desconto), **Custo por categoria** (previsto x real,
% de desvio, "não previsto"), **Resultado** (margem prevista x real, faixa
configurável), **Qualidade do dado** (% de custo automático vs. manual,
itens sem previsão). Seção "Etapas e máquinas": histórico de
`ApontamentoEtapa` (quando entrou/saiu, canal, operador, máquina, aviso de
divergência). Ações: **Fechar pedido** (congela previsto x real),
**Reabrir** (desfaz, registrado em auditoria).

---

## 7. Financeiro

### `/financeiro` (Contas a pagar — Despesas)
Lista despesas (pendente/parcial primeiro, por vencimento), pill de status
(Paga, Parcial, Atrasada, Pendente, "Valor a confirmar" pra variável). Gera
despesas recorrentes pendentes a cada carregamento. Form "Nova despesa":
descrição, categoria, valor, vencimento, recorrência, "valor variável",
filial opcional, fornecedor opcional, **pedido vinculado opcional** (achado
Fin-A1, 2026-09-11 — espelha automaticamente um `CustoPedido` quando pedido
E categoria estão preenchidos, mesma transação; editar atualiza o espelho,
remover o vínculo estorna, excluir a despesa estorna antes de apagar).
Exportação CSV por intervalo livre (`/financeiro/exportar`). Ações:
**marcarComoPaga** (aceita parcial, PagamentoDespesa; valor maior que saldo
rejeitado), **marcarComoPendente** (desfaz tudo), **excluirDespesa**.
Despesas geradas pelo pagamento de comissão não são editáveis por aqui.

### `/financeiro/[id]`
Edição completa da despesa, saldo em aberto, categoria de custo espelhada,
nomes legíveis de filial/conta/fornecedor/pedido mesmo se desativados
depois.

### `/financeiro/contas-receber`
Todas as parcelas esperadas de orçamentos aprovados. 3 cards: Total
pendente, Total vencido, Total recebido — sempre pelo saldo em aberto.
Status: PENDENTE, PARCIAL, **EM_COBRANCA**, RECEBIDO, CANCELADO, **PERDA**
(achado Fin-A5, 2026-09-09 — régua de cobrança manual). Ações:
**registrarBaixaContaReceber** (total/parcial, sempre gera `Pagamento`,
aceita valorTaxa/valorJuros/valorMulta informados manualmente — nunca
calculados sozinhos, só sugeridos no client); **marcarContaReceberEmCobranca**
(sinaliza cobrança manual, ainda conta como pendente); **marcarContaReceberPerda**
(baixa por perda/calote, sai da soma de pendente); **cancelarContaReceber**
(só em PENDENTE); **criarContaReceber** (lançamento manual); **criarRetencaoContaReceber/
excluirRetencaoContaReceber** (tributo retido na fonte — IRRF, CSRF, PIS,
COFINS, CSLL, ISS, INSS, Outro — puramente informativo).

### `/financeiro/contas-prepagas` e `[id]`
Carteiras prepagas em fornecedores (ex: Lalamove) — saldo atual, aviso
"Saldo baixo" (&lt;R$50, visual). Ações: **criarContaPrepaga** (nasce
zerada), **lancarMovimentacaoContaPrepaga** (RECARGA gera `Despesa` já paga
vinculada; DEBITO nunca bloqueado mesmo negativo).

### `/financeiro/creditos-clientes` e `[clienteId]`
Crédito adiantado de cliente (saldo sempre calculado, nunca armazenado).
Extrato Depósito/Consumo/Estorno/Ajuste. **abrirCreditoCliente** só
navega; **lancarMovimentacaoCreditoCliente** — DEPOSITO/ESTORNO/AJUSTE
manuais; CONSUMO só nasce automático na aprovação de orçamento (com trava
de saldo, diferente daqui).

### `/financeiro/comissoes`
Comissões geradas na aprovação de orçamento com vendedor. Base de cálculo,
percentual, valor, status, dados PIX do vendedor (read-only). Ação:
**marcarComissaoPaga** (gera `Despesa` já paga, categoria "Comissão", CAS
contra duplo clique). Cancelamento de pedido reverte comissão PENDENTE
automaticamente. Desde o achado A12 (2026-09-11): vendedor pode ser texto
livre sem cadastro (`representanteNome`, `usuarioId=null`), e existe
`/configuracoes/regras-comissao` pra regras de percentual mais específicas
que a taxa pessoal.

### `/financeiro/dre`
DRE simplificado por mês, cada linha marcada pelo regime (Caixa,
Competência, Misto). Cards: Margem de contribuição (%), Resultado líquido,
Ponto de equilíbrio. Impostos são estimativa (% × receita bruta). Bloco
"Cobertura de overhead": compara overhead cobrado com custo fixo real pago
no período (só leitura). Desde o achado Fin-A5: linha "Receita financeira
(juros/multa recebidos)" soma-se DEPOIS do resultado operacional.

### `/financeiro/auditoria`
Trilha de auditoria geral da gráfica, filtro por funcionário e datas,
últimos 200 registros. Diff antes/depois, quem fez, quando, IP, chip por
tipo de entidade.

---

## 8. Clientes

### `/clientes`
Lista clientes ativos (busca por nome/CPF-CNPJ, paginação de 50), clientes
desativados num `<details>` recolhido. Form "Novo cliente": nome, e-mail,
telefone, CPF/CNPJ, endereço, tipo de pessoa, dados fiscais, origem/segmento
(fechado + Outro), vendedor responsável (só cargo Vendedor ou DONO/ADMIN),
margem de venda diferenciada, observações, preferências de produção. Botão
"Possíveis duplicados" → `/clientes/duplicados`. CPF/CNPJ único por
gráfica.

### `/clientes/[id]`
- Edição completa + gestão de contatos + gestão de endereços + histórico
  somente-leitura.
- Dados comerciais: bloqueado para venda a prazo (aviso, não trava),
  bloqueado para faturamento (trava distinta), limite de crédito, prazo de
  pagamento padrão, forma preferida, desconto padrão negociado (sugestão,
  ainda passa pela alçada), observação financeira separada, "retém imposto
  na fonte" + tipo de tomador.
- Contatos (`ContatosClienteCard`): múltiplos por cliente PJ, função
  (comprador/aprovador de arte/financeiro/recebimento + Outro), um
  principal, soft-delete.
- Endereços adicionais (por tipo: principal/cobrança/entrega), soft-delete.
- Histórico (read-only): faturamento 12 meses, últimos orçamentos, contas a
  receber em aberto/vencidas.
- Ciclo de vida: **Desativar/Reativar** (soft, reversível), **Excluir**
  (hard, só sem orçamentos vinculados), **Anonimizar (LGPD)** (apaga
  dados pessoais, preserva orçamentos/notas fiscais, irreversível).

### `/clientes/duplicados`
Relatório 100% somente-leitura: agrupa clientes (inclusive desativados) pelo
documento normalizado, revelando duplicidade que o índice único (comparação
crua) não pegou. Sem mesclagem automática.

---

## 9. Configurações

### `/configuracoes` (hub — Parâmetros gerais)
Motor de precificação central: ~30 parâmetros em accordions (Precificação,
Aprovação/desconto/crédito, Alertas e prazos, Estoque/custo automático/
comissão, Documento do orçamento, Cadastros auxiliares, Fiscal/identidade/
assinatura, Importação). Um form único (`salvarParametros`) grava tudo.

- Composição de preço: Overhead%, Margem padrão%, Imposto%, Comissão%
  (markup embutido), Taxa financeira%, Pedido mínimo, Incremento de
  arredondamento. Soma margem+imposto+comissão+taxa financeira não pode
  chegar a 85% (bloqueia salvar).
- Referência de alíquota efetiva do Simples (RBT12/Anexo III), informativo.
- Medidor de margem (faixas), unidade de entrada (mm/cm/m — não afeta dados
  salvos), nesting de bobina, faixa de gramatura Offset, motor Editorial
  (páginas por caderno), custo de tinta/ml (só estimativa de IA).
- Alçada de desconto único global (fallback se não houver Alçadas
  configuradas), bloqueio por limite de crédito (opt-in).
- Prazo de entrega (úteis vs corridos + dias de funcionamento), alerta de
  prazo (3 limiares), validade do orçamento, tolerância de tiragem,
  orçamentos parados, aviso de preço/lote desatualizado, sugestão de
  compra/ponto de pedido.
- Custo automático de consumo (desligável), categoria padrão pro consumo,
  perda de calibragem como custo, comissão entra no custo do pedido.
- Comissão: base de cálculo (valor/lucro), se segue vendedor do CLIENTE,
  percentual padrão pra vendedor sem cadastro.
- Toggle de especificações técnicas visíveis, textos/condições do PDF.
- Toda mudança logada em auditoria campo-a-campo.

### `identidade`
Logo, cor primária, dados de contato, perfil de negócio (segmentos, fechado
+ Outro, informativo), dados de recebimento PIX (só exibição).

### `fiscal`
Dados fiscais pra NF-e via Focus NFe (conta própria da gráfica — GrafPro
nunca guarda certificado digital, só token). Ambiente, regime tributário,
CNPJ, endereço, CFOP/CSOSN/natureza padrão. Fora do Simples exige CST-ICMS +
alíquota + modalidade + PIS/COFINS. Token write-only, nunca em auditoria
pelo valor.

### `assinatura`
Billing via Stripe (checkout hospedado + Customer Portal). Status, dias de
trial, uso vs limite, armazenamento vs limite. Cards de plano só pro DONO
sem cortesia/sem assinatura paga viva. Única tela sem gate de módulo/
assinatura ativa (destino de qualquer usuário bloqueado).

### `automacao`
Webhook próprio (n8n ou outro): mudança de status, estoque crítico, pedido
atrasado — 3 toggles. URL write-only, mascarada, nunca em auditoria pelo
valor.

### `filiais` + `[id]`
Unidades da gráfica (catálogo/estoque/financeiro continuam únicos pra
gráfica toda). Nome, endereço, ativa, telefone/e-mail próprios (sobrescrevem
o da Grafica no PDF), logo própria, cor própria, dados fiscais próprios
opcionais (senão usa os da gráfica). Exclusão sempre permitida.

### `perfis-acesso` + `[id]`
RBAC reutilizável (perfis tipo "Impressor", "Acabamento") atribuíveis a
Operadores. Permissão individual sempre vence o perfil. Grade ver/editar por
módulo ("editar" exige "ver"). Gate sempre `exigirPapel(DONO)`. Exclusão
bloqueada se houver usuário vinculado.

### `alcadas`
Até quanto cada papel/usuário aprova sozinho, sem fila encadeada. Tipos:
`DESCONTO_ORCAMENTO` (%, até 100), `APROVACAO_COMPRA` (R$, sem teto). Alvo
papel OU usuário (nunca os dois). Sem nada cadastrado: desconto acima do
limite geral só DONO/ADMIN; compra sem teto nenhum.

### `colaboradores` + `[id]`
Pessoas sem login (motorista terceirizado, operador de chão de fábrica).
Nome, tipo (fechado + Outro), telefone; bloco sensível (CPF, PIX,
especialidade) com gate adicional `FINANCEIRO`. Auditoria nunca grava valor
de CPF/PIX. "Remover" = toggle ativo/inativo.

### `feriados`
Calendário por gráfica (usado em prazo em dias úteis + alerta por e-mail).
Bootstrap de 8 feriados nacionais na primeira visita. Data, descrição,
recorrente anual. Sem soft-delete.

### `prestadores-servico` + `[id]`
Acabamento terceirizado, logística, freelancer — diferente de Fornecedor
(compra de material). Puramente informativo. Nome único por gráfica.

### `transportadoras` + `[id]`
Quem leva a entrega. Nome, telefone, e-mail, documento, RNTRC.

### `contas-financeiras` + `[id]`
Contas bancárias/caixa/poupança/carteira digital — não calcula saldo
automaticamente, só organizacional. Nome, tipo, saldo inicial + data.

### `categorias-custo` + `[id]`
Categorias pra lançar custo real em Produção. Bootstrap de 8 sugestões.
Natureza (Variável/Fixo/Semivariável), reordenável. "Remover" = toggle
(nunca hard delete — `CustoPedido.categoriaCustoId` é Restrict).

### `condicoes-pagamento` + `[id]`
"Jeito de cobrar" (1x faturado, 50%+50%, 30/60/90) — gera parcelas de conta
a receber na aprovação. Bootstrap de 4 condições comuns. Âncora de
vencimento (aprovação/emissão/entrega/outro), acréscimo % opcional, lista de
parcelas (percentual + dias) — **soma precisa fechar 100%** (tolerância
0,01). Editar substitui parcelas inteiras; orçamentos já gerados são
snapshot, nunca afetados.

### `taxas-forma-pagamento` + `[id]`
Quanto a maquininha/banco cobra por forma de pagamento e em quantos dias
compensa — pré-preenche (editável) o campo de taxa ao registrar pagamento.
Forma única por gráfica.

### `fornecedores` + `[id]`
Quem vendeu cada material. Nome (único), contato, categoria (fechado +
Outro), condição de pagamento padrão, prazo médio, pedido mínimo, documento,
endereço (habilita NF-e de remessa de terceirização).

### `ferramentais` + `[id]`
A ferramenta física reutilizável (faca, clichê, tela, matriz de bordado) —
não é o custo dela. Código único, tipo (fechado + Outro), proprietário
(GRAFICA ou CLIENTE, sempre re-derivado no servidor), item do catálogo
vinculado (só produtos), localização, status, tiragens acumuladas.

### `etapas-producao`
Configura o caminho de todo pedido em Produção: liga/desliga cada etapa de
`StatusPedido` (exceto CANCELADO), renomeia com nome próprio da gráfica.
ARTE/PRODUCAO/ENTREGUE nunca podem ficar inativas (validado no servidor).
Ordem de exibição + toggle "exige aprovação de qualidade" (achado D1,
2026-09-11).

### `regras-comissao`
Exceções à taxa única de comissão de cada vendedor: percentual diferente por
pessoa, produto/categoria, ou faixa de margem. Regra mais específica que
bater vence (mais filtros preenchidos = mais específica); sem regra, taxa
pessoal de sempre. Campos: prioridade, usuário opcional, item opcional, tipo
de item opcional, margem mín/máx, percentual obrigatório >0, base de
cálculo opcional. "Remover" é hard delete (comissão é snapshot histórico).

### Máquinas (`maquinas` hub + 6 sub-CRUDs)
Todas entram no motor de precificação — mudar valor afeta orçamento futuro.
Badge "Em manutenção" quando há parada ativa; exclusão bloqueada se algum
produto do catálogo ainda usa a máquina.

- **Offset (Prensa)** (`prensas/[id]`): hora-máquina, nº de torres, custo da
  chapa, acerto (h + folhas), milheiro de rodagem, rodagem mínima, perda %.
- **Flexografia** (`maquinas/flexografia/[id]`): largura, passo do cilindro,
  nº de estações, hora-máquina, acerto (h + metros), metro linear de
  rodagem, rodagem mínima, perda %.
- **Impressão Digital** (`maquinas/impressao-digital/[id]`): só custo por
  clique.
- **Bordado** (`maquinas/bordado/[id]`): custo por mil pontos, taxa de
  digitalização de matriz, nº de cabeças, hora-máquina opcional, mínimo
  opcional — cobra por pontos da arte, não por peça fixa.
- **Setup por peça** (Serigrafia/Sublimação/Estampagem a quente,
  `maquinas/setup-por-peca/[id]`): tipo de processo (fechado + Outro, cada
  máquina serve um único processo), custo por setup, por peça, mínimo.
- **Tempo de máquina** (corte/gravação a laser, router CNC, plotter,
  `maquinas/tempo-maquina/[id]`): hora-máquina, setup por job, mínimo
  opcional, custo por metro de corte opcional.
- **Equipamentos** (sem custo próprio, `maquinas/equipamentos/[id]`):
  guilhotina, laminadora, plotter — categoria (fechado + Outro), marca,
  modelo, largura máxima opcional, tecnologia — puramente informativo (não
  entra na precificação).
- **Manutenção** (`maquinas/manutencao`): início/fim de paradas (Preventiva
  ou Quebra) pra prensa/flexografia/equipamento/impressora digital/setup-
  por-peça (bordado e tempo-máquina não entram). Bloqueia duas paradas
  simultâneas na mesma máquina. Histórico das últimas 50 encerradas.

---

## 10. Usuários / Permissões

### `/usuarios`
Acesso restrito a DONO. Bootstrap idempotente de 6 cargos padrão (Vendedor,
Financeiro, Produção, Compras, Administrativo, Atendimento) na primeira
visita.

- **Novo usuário**: nome, e-mail (único global), senha, papel (Admin/
  Operador), cargos (multi-cargo). Já nasce com e-mail verificado (convite
  de um DONO).
- **Lista**: ativos/desativados, cargos por linha.
- **Perfis de acesso**: link pra `/configuracoes/perfis-acesso`.
- **Acesso ao Meu Negócio**: switch geral da gráfica + concessão
  individual (padrão: só DONO vê).
- **Comissão por vendedor**: percentual (0–1) por pessoa, independente de
  papel.
- **Dados de pagamento**: CPF, chave PIX (+ tipo), especialidade — visível
  só com permissão de FINANCEIRO; nunca em PDF nem lista.
- **Responsáveis por etapa**: quem recebe e-mail quando um pedido chega
  numa etapa atribuível.
- **Responsáveis administrativos**: quem recebe e-mail quando um orçamento
  aprovado está pronto pra NF-e, ou pedido perto/passado do prazo.
- Regras: funcionário desativado nunca é zerado silenciosamente (excluído
  do conjunto processado, preserva valor gravado); "Remover" = soft delete
  (`desativarUsuario`, apaga sessões ativas na hora); DONO não se
  autodesativa nem desativa outro DONO; reativar não recria sessão; toda
  mudança relevante é auditada (exceto valor de CPF/PIX); afeta contagem de
  seats no billing.

### `/usuarios/[id]/permissoes`
Só se aplica a papel OPERADOR (DONO/ADMIN têm acesso total automático).
Grade módulo a módulo: "pode ver"/"pode editar" (editar exige ver). Diff
antes/depois auditado.

---

## 11. Meu Negócio / Relatórios

### `/meu-negocio` (dashboard executivo)
Acesso condicionado (DONO sempre; outros via switch + concessão
individual). Hero: faturamento aprovado do mês + sparkline 8 semanas. Tiras:
clientes, produtos ativos, orçamentos do mês, saldo real do mês (regime de
caixa), despesas a pagar no mês. Funil de orçamentos (conversão + tempo
médio até aprovação). Pipeline de produção (se houver pedido). Previsão de
estoque, ranking de clientes. Projeção de fluxo de caixa (90 dias, alerta se
negativo com a data).

### `/meu-negocio/relatorios`
Filtros: período (padrão mês atual) + cliente (até 200). Métricas:
faturado, pedidos, ticket médio, custos, lucro. Medidor de margem (faixas
configuráveis) + estimativa de imposto/lucro líquido (não é imposto
efetivamente pago, não desconta custo fixo). Top 5 clientes, custos por
categoria, produtos mais vendidos. Seções fixas de 12 meses (independentes
do filtro): Ranking geral, Faturamento mês a mês, Faturamento por cliente ×
mês. Botão "Exportar CSV do período".

---

## 12. Importação

### `/importar` (hub)
Cards só pros tipos com permissão: **Clientes**, **Catálogo** (produtos/
serviços/matéria-prima), **Pedidos históricos**. Contador de uso mensal (por
plano).

### `/importar/[tipo]` (wizard com IA)
1. **`solicitarMapeamento`**: valida arquivo (.xlsx/.csv, assinatura de
   bytes), parse em memória, checa cota mensal, reserva armazenamento,
   envia cabeçalhos + amostra (nunca a planilha inteira) pra webhook de IA
   (n8n) que sugere mapeamento — sempre revalidado contra a lista fechada de
   campos do tipo.
2. **`confirmarEImportar`**: usuário confirma/ajusta mapeamento; rejeita
   campo obrigatório não mapeado; relê o arquivo original; grava linha a
   linha em lotes de 10 paralelos, cada linha em sua própria transação
   (erro numa linha não derruba as demais).

Janela de 30min pra confirmar depois de solicitado. Pedidos entram direto
como aprovado/entregue (sem calculadora), só vinculando cliente. Cota
consumida no passo 1, mesmo que a IA falhe depois.

---

## 13. Administração da plataforma / Ajuda / Landing

### `/admin/graficas`
Painel de administração da própria plataforma SaaS (não de uma gráfica) —
só `superAdmin=true`, única query do sistema sem filtro por `graficaId`.
Lista todas as gráficas, busca por nome/e-mail do dono, status de
assinatura, conceder/revogar acesso "cortesia" (grátis permanente, fora do
Stripe).

### `/ajuda` (Central de Ajuda)
Conteúdo estático, sem gate de módulo/permissão — documenta o que cada
módulo faz de verdade, mantido manualmente em sincronia com o código.

### `/` (landing page)
Marketing público: header Entrar/Cadastrar, seção de recursos — puramente
institucional, sem lógica de negócio.
