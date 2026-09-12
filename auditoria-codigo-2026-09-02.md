# Auditoria de código — GrafPro (2026-09-02)

> Gerada por subagente Opus, lente = princípio de abrangência para produção em
> escala ("o sistema assume que toda gráfica é a Assus"). Leu `arquitetura-resumo.md`,
> `pesquisa-abrangencia-modulos.md` e `schema.prisma` antes de mergulhar no código.
> Nenhum arquivo foi alterado; achados confirmados por leitura de código e
> rastreamento de call-site, não por execução de testes.

## 1. Resumo executivo

18 achados **NOVOS** (não presentes em `pesquisa-abrangencia-modulos.md`): **6 🔴 alta**, **8 🟡 média**, **4 🟢 baixa**. Além disso, 3 achados já marcados CONSTRUÍDO ficaram com resíduo real.

Os 3 piores, todos com dinheiro em jogo e todos alcançáveis pela UI hoje:

1. **`ModeloCalculo.SIMPLES` multiplica o preço pela área sempre que o vendedor preenche largura/altura** — os campos são "opcional" em toda linha de orçamento, inclusive de produto vendido por peça. Uma camiseta de R$45 com 30×40cm digitados vira R$5,40. Silencioso.
2. **Cancelar um pedido não desfaz nada do financeiro**: a `ContaReceber` continua PENDENTE, a `Comissao` continua pagável, e `Orcamento.status` continua APROVADO — então o pedido cancelado segue contando como faturamento em `/meu-negocio`.
3. **"Pedido mínimo (R$)" é aplicado por ITEM, não por pedido** (`compor.ts:70`) — um orçamento de 5 linhas pequenas cobra 5× o mínimo.

Observação de método: a base é notavelmente disciplinada (CAS em toda transição, snapshot em aprovação, `server-only`, comentários que explicam o *porquê*). A maior parte dos defeitos que sobram está nas **bordas entre módulos** (motor → estoque, produção → financeiro, orçamento → fiscal), não dentro deles.

---

## 2. Achados NOVOS (mais grave primeiro)

### N1 — `SIMPLES` transforma preço/peça em preço/m² se o vendedor preencher as dimensões
- **Domínio:** Catálogo/Motor de Preço + Orçamento
- **Arquivo:** `src/lib/orcamento.ts:16-27`; formulário em `src/app/orcamento/SeletorItemOrcamento.tsx:304-330`
- **Categoria:** `bug-logica` (com forte componente de `abrangencia`)
- **Severidade:** 🔴 alta
- **Descrição:**
  ```ts
  const temDimensoes = Boolean(larguraCm && alturaCm);
  const areaM2 = temDimensoes ? (larguraCm! / 100) * (alturaCm! / 100) : 1;
  const precoUnitario = Math.round(precoBase * areaM2 * 100) / 100;
  ```
  A decisão "este produto é cobrado por m² ou por peça" **não é uma propriedade do produto** — é inferida de o vendedor ter digitado ou não largura/altura naquela linha. E os campos Largura/Altura são renderizados em **toda** linha de orçamento, sem gate por modelo, com `placeholder="opcional"` e `required={exigeDimensao}` (falso para SIMPLES).
  Cenário concreto: uma **estamparia/vestuário** cadastra "Camiseta estampada" como SIMPLES, `precoVenda = 45`. O vendedor preenche 30 × 40 (área de estampa, dado descritivo). `areaM2 = 0,12` → `precoUnitario = R$ 5,40`. 100 camisetas saem por R$ 540 em vez de R$ 4.500, sem aviso nenhum. Idem para **brindes**, **corte a laser/acrílico** e **editorial** — todos perfis em que a dimensão é descritiva, não de faturamento. O projeto até reforça esse hábito: o achado F7 (profundidade/espessura) foi construído explicitamente como campo *descritivo* logo abaixo dos mesmos inputs (`SeletorItemOrcamento.tsx:510-519`).
  O inverso também morde: quem *quer* preço por m² e esquece de digitar as dimensões cobra `precoBase × 1` por peça.
- **Status vs. documento:** NOVO.

### N2 — Cancelar pedido não cancela `ContaReceber`, não cancela `Comissao`, e o orçamento continua APROVADO (contando como faturamento)
- **Domínio:** Produção / Financeiro
- **Arquivo:** `src/app/producao/actions.ts:227-420` (transação em `:263-351`); consumo em `src/lib/meu-negocio.ts:136-140` e `:176-178`
- **Categoria:** `bug-logica`
- **Severidade:** 🔴 alta
- **Descrição:** `cancelarPedido` faz um trabalho cuidadoso de estorno de estoque (pelo histórico de `MovimentacaoEstoque`, não pela ficha técnica) e marca `CustoPedido.estornadoEm` nos custos automáticos. Mas a transação **não toca em nenhuma das três consequências financeiras da aprovação**:
  - `ContaReceber` gerada por `gerarContasReceberDaAprovacao` fica `PENDENTE` para sempre → entra no aging, na exposição de crédito do cliente (`calcularExposicaoCreditoCliente`) e pode até bloquear novas vendas desse cliente por limite de crédito de um pedido que não existe mais.
  - `Comissao` (snapshot criado na aprovação, `@unique` por orçamento) fica `PENDENTE` → o vendedor é pago comissão sobre um pedido cancelado; nada no fluxo de `marcarComissaoPaga` checa `Pedido.status`.
  - `Orcamento.status` continua `APROVADO`, e `buscarVisaoGeralNegocio` calcula `faturamentoMes` como `orcamento.aggregate({ where: { status: "APROVADO", ... }, _sum: { total } })` — o pedido cancelado **continua sendo faturamento** no dashboard, e o `saldoReal` junto.

  Grep confirma: nenhuma ocorrência de `contaReceber`/`comissao` em `src/app/producao/` fora de um comentário de teste.
- **Status vs. documento:** NOVO (o A3/Parte 4 catalogado cobre "faturamento por data de criação / mistura competência com caixa", mas não o vazamento de pedido cancelado).

### N3 — "Pedido mínimo" é um piso por ITEM, não por pedido
- **Domínio:** Catálogo/Motor de Preço
- **Arquivo:** `src/lib/pricing/compor.ts:70`; rótulo em `src/app/configuracoes/ParametrosForm.tsx:203`
- **Categoria:** `bug-logica`
- **Severidade:** 🔴 alta
- **Descrição:** `const precoComPiso = maiorDec(precoBruto, paraDecimal(params.parametros.pedidoMinimo))` roda dentro de `comporPreco`, que é chamado **uma vez por linha de orçamento**. O campo é rotulado "Pedido mínimo (R$)" na tela de Configurações e não há nenhum piso agregado em lugar nenhum (grep de `pedidoMinimo`: só `compor.ts`).
  Cenário concreto: **gráfica rápida** com pedido mínimo R$ 30. Cliente pede 100 cartões (custo→R$ 12), 50 panfletos (R$ 9) e 1 crachá (R$ 4) no mesmo orçamento. O sistema cobra R$ 90 em vez de R$ 30. É exatamente o perfil que mais faz orçamento multi-linha de valor baixo, e o erro é sistemático e para cima (o cliente reclama, ou a gráfica desliga o parâmetro e perde a proteção real).
  Efeito colateral menor no mesmo lugar: o piso é aplicado **antes** do arredondamento, então `arredondarParaIncremento` pode devolver um valor abaixo do mínimo configurado.
- **Status vs. documento:** NOVO.

### N4 — Motor DIGITAL não tem imposição: `numeroCliques` é inteiro ≥ 1 **por peça** e o substrato é `Q × preço da folha`
- **Domínio:** Catálogo/Motor de Preço
- **Arquivo:** `src/lib/pricing/digital.ts:28-33`; validação em `src/lib/pricing/validar.ts:126-135`; carregamento em `src/lib/pricing/carregar.ts:290-292`
- **Categoria:** `abrangencia`
- **Severidade:** 🔴 alta
- **Descrição:**
  ```ts
  const custoCliques = paraDecimal(Q).times(numeroCliques).times(params.custoPorClique);
  const custoSubstrato = paraDecimal(Q).times(contexto.custoSubstratoPorPeca);
  ```
  Não há `nUp`, não há folha, não há `FormatoFolha` (o branch OFFSET é o único que lê `formatosFolha`). E `validarPedidoDigital` exige `Number.isInteger(numeroCliques) && numeroCliques >= 1` — ou seja, **é impossível expressar "muitas peças saem de um clique"**.
  Cenário concreto: uma **gráfica rápida** roda 1.000 cartões de visita 24-up em SRA3 numa Ricoh. Real: ~42 cliques e ~42 folhas. O sistema cobra `1000 × custoPorClique` + `1000 × precoCompra da folha` — 24× o custo real de material e de clique. O único contorno é falsificar `ImpressoraDigital.custoPorClique` e `ItemGrafica.precoCompra` para valores "por peça", mas `custoPorClique` mora na **máquina** e é compartilhado por todos os produtos que usam aquela impressora — falsificá-lo para o cartão quebra o preço do folder A4 1-up na mesma máquina.
  Gráfica rápida + digital é, junto com comunicação visual, o maior mercado-alvo declarado — e é o motor que menos representa a operação dele.
- **Status vs. documento:** NOVO. Os achados A7 (chapa rígida) e A8 (M2) da Parte 1 cobrem outros motores; DIGITAL é tratado no documento como "sem nesting de propósito", sem registrar a consequência de custo.

### N5 — A baixa de estoque e o custo real ignoram o consumo que o motor de preço já calculou
- **Domínio:** Produção / Catálogo
- **Arquivo:** `src/app/producao/status-transicao.ts:454` e `:565`; `prisma/schema.prisma:2206-2228` (`FichaTecnicaItem`)
- **Categoria:** `bug-logica` + `abrangencia`
- **Severidade:** 🔴 alta
- **Descrição:** A baixa em `CLICHE_FACA → PRODUCAO` faz `quantidadeConsumida = Number(ficha.quantidadePorUnidade) * item.quantidade` — um consumo **linear por unidade vendida**, congelado no cadastro do produto. Enquanto isso, o motor já calculou e gravou em `OrcamentoItem.breakdown` o consumo físico real: `folhasTotais` (boas + perda + `folhasAcerto × entradas`) no offset, `areaFaturavel` no M2, `metragemTotal` na flexo. **Nada disso é lido pela baixa.**
  Duas consequências:
  - **O consumo linear é estruturalmente impossível de acertar** para produto cujas dimensões variam por orçamento — que é a norma no offset (`OrcamentoItem.larguraCm/alturaCm` são por item). O `nUp` de um folder 10×21 e de um cartaz A3 no mesmo papel é diferente por um fator de 8; um único `quantidadePorUnidade` não pode representar os dois.
  - **As folhas de acerto e a perda percentual nunca saem do estoque.** `perdaFixaPadrao` é uma quantidade *fixa por entrada em produção*, não escala com a tiragem nem com `entradas`. Num pedido offset de 5.000 peças 4/4 com `folhasAcerto=150`, o motor cobrou 450 folhas de perda+acerto do cliente e o estoque baixou 0 delas — e o `CustoPedido` origem `CONSUMO_ESTOQUE` (o número que sustenta "quanto esse pedido me deu de lucro", o diferencial declarado do produto) fica subestimado pelo mesmo tanto.
- **Status vs. documento:** NOVO. (B3/Parte 2 cobre refugo *pós*-produção; isto é o consumo planejado que o motor já sabe e o estoque não usa.)

### N6 — `icms_origem: "0"` fixo em todo item de NF-e, sem nenhum campo de origem no catálogo
- **Domínio:** Clientes/Fiscal
- **Arquivo:** `src/lib/focus-nfe.ts:273`; `prisma/schema.prisma:1968-1990` (`ItemCatalogo` só tem `ncm`)
- **Categoria:** `fiscal`
- **Severidade:** 🔴 alta
- **Descrição:** `mapearItemNfePayload` emite `icms_origem: "0"` (= "Nacional, exceto os códigos 3 a 5") para **todo** item, de **toda** gráfica. Não existe campo de origem em `ItemCatalogo`, `ItemGrafica` nem `DadosFiscaisGrafica` — não há nem escape.
  Cenário concreto: uma gráfica de **brindes personalizados** revende canecas, canetas e power banks importados (`ModeloCalculo.REVENDA` foi construído exatamente para isso) — origem correta é 1, 2, 6 ou 7. Uma gráfica de **comunicação visual** que revende chapa de ACM/acrílico importado, idem. Uma gráfica de **DTF** com filme importado, idem. Todas emitem NF-e declarando origem nacional. Isso é informação fiscal incorreta no XML autorizado (afeta ICMS de 4% interestadual da Resolução SF 13/2012 e a FCI), e não é corrigível por configuração — só por mudança de código.
  Colateral no mesmo arquivo: `valor_frete: "0"` e `valor_seguro: "0"` também fixos (isso sim já catalogado, F3/Parte 7), e `tipo_documento: "1"` / `finalidade_emissao: "1"` fixos — ver Resíduo R3.
- **Status vs. documento:** NOVO.

### N7 — CFOP interestadual não distingue contribuinte de não-contribuinte, embora o campo já exista desde a rodada 12
- **Domínio:** Clientes/Fiscal
- **Arquivo:** `src/lib/nota-fiscal.ts:146-163`
- **Categoria:** `fiscal`
- **Severidade:** 🟡 média
- **Descrição:** `resolverCfop` só bifurca por UF (`cfopPadrao` vs `cfopPadraoInterestadual`). O comentário logo acima diz:
  > "não distingue cliente contribuinte vs não-contribuinte de ICMS (6102 vs 6108, com implicação de DIFAL) — isso depende do indicador de contribuinte do cliente, **campo que ainda não existe no schema (achado A1, não construído)**"

  O comentário está desatualizado: `Cliente.indicadorInscricaoEstadual` **foi construído** (A1/Parte 5, rodada 12) e é lido 8 linhas acima, em `verificarProntidaoFiscal:139`, e enviado no payload em `focus-nfe.ts:337`. A dependência que bloqueava o achado A3 caiu e ninguém religou o fio.
  Cenário concreto: gráfica em SP vende adesivos para pessoa física no RJ. Sai CFOP 6102 (venda a contribuinte) em vez de 6108, e o DIFAL de consumidor final não-contribuinte não é considerado.
- **Status vs. documento:** JÁ CATALOGADO como A3/Parte 5 ("PARCIALMENTE CONSTRUÍDO"), mas reportado aqui porque **o bloqueio declarado no próprio código já não existe** — o resto é barato agora e o comentário induz ao erro de achar que ainda é caro.

### N8 — No OFFSET, papel e gramatura são propriedade do PRODUTO, não do orçamento
- **Domínio:** Catálogo/Motor de Preço
- **Arquivo:** `src/lib/pricing/carregar.ts:216-251` (`item.papel`, `item.gramaturaGm2`); comparar com o caminho de etiqueta em `:166-194` (`dadosEtiqueta.papelId`, escolhido no orçamento)
- **Categoria:** `abrangencia`
- **Severidade:** 🟡 média
- **Descrição:** O documento de auditoria afirma, no achado A8, que "o Offset já resolveu isso com `papelId` + `TabelaPrecoPapel`; o M2 não herdou". Só que `papelId` e `gramaturaGm2` são colunas de `ItemGrafica` — resolvem "de que papel esse produto é feito", **não** "em que papel este orçamento vai sair". Só o motor de clichê de etiqueta (M2) tem override por orçamento.
  Cenário concreto: uma **gráfica offset comercial** cota "Folder A4 4/4" e o cliente pede três opções: couché 90g, 115g e 150g. O vendedor precisa criar 3 produtos separados no catálogo (cada um com seus `FormatoFolha` re-cadastrados), ou usar `OrcamentoOpcao` — que também exige 3 produtos. Variar papel/gramatura é a variação **mais básica** do orçamento offset brasileiro, e é a única que o modelo não suporta.
- **Status vs. documento:** NOVO (A8 trata só do M2 e declara o offset resolvido).

### N9 — A rodagem cobra as folhas/metros de acerto `entradas²` vezes, contra o próprio texto de ajuda
- **Domínio:** Catálogo/Motor de Preço
- **Arquivo:** `src/lib/pricing/offset.ts:110-111, 157-161`; mesmo padrão em `src/lib/pricing/flexografia.ts:84, 102-106`
- **Categoria:** `bug-logica`
- **Severidade:** 🟡 média
- **Descrição:** `folhasTotais = folhasBoas + folhasPerda + folhasSetup`, onde `folhasSetup = params.folhasAcerto * entradas` (`:95`). Depois:
  ```ts
  const custoRodagemPorEntrada = maiorDec(rodagemMinima, paraDecimal(escolhido.folhasTotais).div(1000).times(custoMilheiroRod));
  const custoRodagem = paraDecimal(entradas).times(custoRodagemPorEntrada);
  ```
  As folhas de acerto já foram multiplicadas por `entradas` uma vez e são multiplicadas de novo — `folhasAcerto × entradas²`. Fisicamente, cada passada roda as folhas boas + a perda + **o acerto daquela passada**, não o acerto de todas.
  Que é bug e não decisão está no texto de ajuda do próprio campo (`src/app/configuracoes/prensas/[id]/PrensaForm.tsx:128`): *"Custo variável cobrado a cada mil folhas impressas, **já descontado o acerto**"* — o código faz o oposto, inclui o acerto e ainda o duplica.
  Números: prensa 4 torres, `folhasAcerto=150`, `custoMilheiroRod=R$40`, job 4/4 (entradas=2), 5.000 peças 1-up, perda 3% → o código cobra R$ 436,00; a contagem física de passadas dá R$ 424,00; a leitura literal do texto de ajuda dá R$ 412,00. Escala com `entradas`, então dói mais em job de 6/6 numa prensa de 2 cores (entradas=6 → acerto contado 36× em vez de 6×). `flexografia.ts` repete a estrutura com `metrosAcerto`.
- **Status vs. documento:** NOVO.

### N10 — `custoFaca` é aceito no contexto, silenciosamente descartado no branch OFFSET, e só digitável em produto M2 com clichê de etiqueta
- **Domínio:** Catálogo/Motor de Preço + Orçamento
- **Arquivo:** `src/lib/pricing/precificar.ts:232-248` (OFFSET, único branch sem `custoFaca`); `src/lib/orcamento-precificacao.ts:301`; UI em `src/app/orcamento/SeletorItemOrcamento.tsx:495-501` e `CamposPrecificacaoEtiquetaOrcamento.tsx:89-102`
- **Categoria:** `bug-logica` + `abrangencia`
- **Severidade:** 🟡 média
- **Descrição:** Duas metades do mesmo problema:
  - `calcularItemOrcamento` faz `if (dados.custoFaca !== null) contexto.custoFaca = dados.custoFaca` **para qualquer `modeloCalculo`**, mas dos 6 branches de `precificar`, só o OFFSET não repassa `custoFaca` a `comporPreco`. Um item OFFSET com faca informada (alcançável via `editarOrcamento`/`adicionarItemOrcamento`, que leem `formData.get("custoFaca")` sem gate por modelo — `orcamento/[id]/actions.ts:646` e `:1609`) tem o custo aceito, validado e **jogado fora sem erro**.
  - A UI só renderiza o campo quando `usaClicheEtiqueta` — ou seja, faca é tratada como conceito de etiqueta. Cenário concreto: uma gráfica de **embalagem/cartonagem** imprime caixa em offset e paga R$ 900 de faca de corte-e-vinco. Não há onde digitar isso no orçamento; se forçar pelo FormData, o valor some. Mesma situação para pasta com faca em gráfica offset comercial.
- **Status vs. documento:** NOVO. (O achado F1/Parte 7, `Ferramental`, foi construído como *cadastro* de faca reutilizável — não fechou o caminho do custo entrar no preço do item OFFSET.)

### N11 — A trava de "preço abaixo do custo" no desconto usa custo zero quando não há breakdown, e ignora a área em SIMPLES
- **Domínio:** Orçamento
- **Arquivo:** `src/app/orcamento/[id]/actions.ts:2040-2055`; mesma regra em `src/lib/orcamento-margem.ts:44-46`
- **Categoria:** `bug-logica`
- **Severidade:** 🟡 média
- **Descrição:**
  ```ts
  const custoDiretoNumero = breakdown?.custoTotal
    ? Number(breakdown.custoTotal)
    : item.itemGrafica.precoCompra
      ? Number(item.itemGrafica.precoCompra) * quantidade
      : 0;
  ```
  Dois furos:
  - **Fallback `0`**: item SIMPLES sem `precoCompra` cadastrado (caso comum: serviço, revenda de terceiro, item importado por planilha) tem piso de custo **zero** — pode ser descontado a R$ 0,01. Como `descontoMaxSemAprovacao` tem default 100 (= sem trava), nada mais segura.
  - **Área ignorada**: para SIMPLES com dimensões, o preço escala por m² mas o custo é `precoCompra × quantidade`, sem área. Cenário concreto: comunicação visual, "Banner lona 440g" SIMPLES, `precoVenda 60`/m², `precoCompra 18`/m². Item de 1 unidade 3×2m → `precoTotal = R$ 360`, custo estimado = **R$ 18** (real ≈ R$ 108). A margem exibida em `/orcamento/[id]` diz 95% (real 70%), e a trava permite fechar o banner por R$ 19.
- **Status vs. documento:** NOVO.

### N12 — Fallback silencioso de gramatura de papel; o flag `APROXIMADO` é calculado e descartado
- **Domínio:** Catálogo/Motor de Preço
- **Arquivo:** `src/lib/pricing/papel.ts:34-42`; consumo em `src/lib/pricing/carregar.ts:231-237` (`const { precoKg } = resolverPrecoPapel(...)`)
- **Categoria:** `divida-tecnica` / `bug-logica`
- **Severidade:** 🟡 média
- **Descrição:** `resolverPrecoPapel` devolve `{ precoKg, gramaturaBase, origem: "EXATO" | "APROXIMADO" }` justamente para o chamador poder avisar. `carregarContextoPrecificacao` desestrutura **só `precoKg`** — `origem` e `gramaturaBase` são jogados fora, não entram no `breakdown`, não viram aviso.
  Cenário concreto: uma **gráfica editorial** cadastra "Offset 75g" com tabela de preço só em 90g e 120g. Orça um miolo em 75g → o motor usa silenciosamente o R$/kg do 90g (mais próximo; empate resolve para a maior, "protege a margem"), mas o **peso** da folha usa os 75g reais. O orçamento sai com um preço/kg que não corresponde ao papel, e nada na tela nem no PDF indica isso. O motor tem a informação e escolhe não mostrá-la.
- **Status vs. documento:** NOVO.

### N13 — Faixa de gramatura 30–500 g/m² hardcoded no validador do offset
- **Domínio:** Catálogo/Motor de Preço
- **Arquivo:** `src/lib/pricing/validar.ts:88-94`
- **Categoria:** `abrangencia`
- **Severidade:** 🟡 média
- **Descrição:** `if (contexto.gramaturaGm2 < 30 || contexto.gramaturaGm2 > 500) throw GRAMATURA_INVALIDA`. Constante em código, não configurável por gráfica, sem escape.
  Quebra em duas pontas reais: **embalagem/cartonagem** imprime offset em cartão duplex/triplex de 450–600 g/m² e em micro-ondulado E-flute cuja gramatura composta passa de 500 — a cotação simplesmente aborta com "a gramatura precisa estar entre 30 e 500". Na ponta baixa, **editorial** usa papel bíblia (22–40 g/m²) e a gráfica de embalagem flexível usa filmes abaixo de 30. É o padrão "enum-fechado sem `OUTRO`" do projeto reproduzido como faixa numérica, contrariando o princípio de "configurabilidade em vez de hardcode" que o resto do schema segue com rigor.
- **Status vs. documento:** NOVO.

### N14 — `ConfiguracaoAcabamento.estagio` (PRE_REFILE/POS_REFILE) é gravado, carregado pelo motor e nunca lido
- **Domínio:** Catálogo/Motor de Preço
- **Arquivo:** campo em `prisma/schema.prisma:1956-1959` e `:2299+`; UI em `src/app/catalogo/[itemGraficaId]/ConfiguracaoAcabamentoForm.tsx:21`; carregado em `src/lib/pricing/carregar.ts:371`; **zero leituras** em `src/lib/pricing/acabamento.ts`
- **Categoria:** `divida-tecnica`
- **Severidade:** 🟢 baixa
- **Descrição:** O enum tem comentário no schema, é uma pergunta obrigatória no cadastro de acabamento, é semeado com valores distintos em `dados-exemplo.ts` (`PRE_REFILE` para laminação, `POS_REFILE` para corte), viaja até o `ConfigAcabamento` do motor puro — e `calcularQtdBase`/`calcularCustoAcabamento` nunca o consultam. Quem cadastra acredita estar configurando algo que muda a conta (o comentário de `BaseCobranca.FOLHA_IMPRESSA` fala justamente de "antes do refile"), e não muda nada. Ou o campo passa a governar a base de cobrança, ou o formulário deveria dizer que é descritivo — hoje é a única configuração do motor que mente.
- **Status vs. documento:** NOVO.

### N15 — Receber uma compra cria saldo de estoque em item deliberadamente sem controle de estoque
- **Domínio:** Compras / Catálogo
- **Arquivo:** `src/app/compras/status-transicao.ts:171-202`
- **Categoria:** `bug-logica`
- **Severidade:** 🟢 baixa
- **Descrição:** `estoqueAtual = null` é a convenção do projeto para "este material não tem controle de estoque" — a baixa de produção respeita isso explicitamente (`status-transicao.ts:453`: `if (estoqueAtual === null) continue;`). Compras não respeita: `new D(estoqueAnterior?.toString() ?? 0).plus(quantidadeDec)` transforma `null` em número, e o CAS `where: { estoqueAtual: estoqueAnterior ?? null }` casa com o `null` e grava.
  Cenário concreto: uma gráfica que não controla estoque de tinta registra uma compra de 5 L. A tinta passa a ter `estoqueAtual = 5` e entra em `calcularPrevisaoEstoque` / alertas de estoque crítico — com um saldo que ninguém mantém, porque a produção continua ignorando o item (`fichaTecnica` não baixa nada de item sem estoque). O saldo só cresce, para sempre.
- **Status vs. documento:** NOVO.

### N16 — `resolverConfigAcabamentos` não filtra acabamento desativado
- **Domínio:** Catálogo/Motor de Preço
- **Arquivo:** `src/lib/pricing/carregar.ts:344-347`
- **Categoria:** `divida-tecnica`
- **Severidade:** 🟢 baixa
- **Descrição:** `prisma.itemGrafica.findMany({ where: { id: { in: itemGraficaIds }, graficaId } })` — sem `ativo: true`. Compare com o caminho do papel de etiqueta 170 linhas acima, que filtra `ativo: true` explicitamente (`:178`). Um `ItemGrafica` de serviço desativado no catálogo continua precificável se o id chegar no FormData (ou se o item já estava selecionado numa aba aberta antes da desativação). Inconsistência com o soft-delete "quase universal" que o projeto documenta como padrão.
- **Status vs. documento:** NOVO.

### N17 — A NF-e ignora `OrcamentoItem.descricaoLivre` e usa sempre o nome genérico do catálogo
- **Domínio:** Clientes/Fiscal
- **Arquivo:** `src/app/orcamento/[id]/actions.ts:3105` (`descricao: item.itemGrafica.itemCatalogo.nome`)
- **Categoria:** `divida-tecnica` / `fiscal`
- **Severidade:** 🟢 baixa
- **Descrição:** `descricaoLivre` foi construído (B6/Parte 1, rodada 9) exatamente para sobrepor o nome do catálogo no PDF e no link público. A emissão de NF-e não o usa. O cliente recebe uma proposta dizendo "Banner 3×1m lona 440g com bastão e corda" e uma nota fiscal dizendo "Banner em Lona" — descrição do produto no XML divergente do documento comercial, e sem a especificação que a fiscalização espera.
- **Status vs. documento:** NOVO.

### N18 — Nenhum motor tem mínimo faturável por peça/m²; `areaMinimaFaturavel` é só métrica
- **Domínio:** Catálogo/Motor de Preço
- **Arquivo:** `src/lib/pricing/m2.ts:198-202` (`areaCobrada` nunca entra em `custoBase`), hint em `ConfiguracaoProdutoForm.tsx:438`
- **Categoria:** `abrangencia`
- **Severidade:** 🟡 média
- **Descrição:** O comportamento é **deliberado e documentado** (o hint diz "Métrica de auditoria — o piso comercial real é o pedido mínimo em Configurações"), então não é bug. Mas combinado com N3, o efeito líquido é que **não existe piso por m²/peça em lugar nenhum** — só um piso em R$ que é aplicado por item. "Cobro no mínimo 1 m² por peça de adesivo recortado" e "cobro no mínimo 0,5 m² de lona" são regras universais em comunicação visual, e nenhuma é representável. Registro aqui porque a correção de N3 (mover o piso para o pedido) deixaria esse buraco ainda mais visível, e os dois deveriam ser desenhados juntos.
- **Status vs. documento:** NOVO.

---

## 3. Bugs de lógica reais (índice)

Distintos de abrangência, todos com input e resultado errado descritos acima:

| # | Bug | Arquivo |
|---|---|---|
| N1 | Preço SIMPLES dividido pela área quando o vendedor digita a dimensão | `src/lib/orcamento.ts:16-27` |
| N2 | Cancelamento de pedido não desfaz ContaReceber / Comissao / faturamento | `src/app/producao/actions.ts:263-351` |
| N3 | `pedidoMinimo` aplicado por item, e antes do arredondamento | `src/lib/pricing/compor.ts:70-74` |
| N5 | Estoque/custo real ignoram o consumo calculado pelo motor | `src/app/producao/status-transicao.ts:454` |
| N9 | Folhas/metros de acerto cobrados `entradas²` vezes na rodagem | `src/lib/pricing/offset.ts:157-161`, `flexografia.ts:102-106` |
| N10 | `custoFaca` descartado sem erro no branch OFFSET | `src/lib/pricing/precificar.ts:232-248` |
| N11 | Piso de custo do desconto cai em `0`; ignora área em SIMPLES | `src/app/orcamento/[id]/actions.ts:2040-2047` |
| N12 | Preço de papel aproximado sem aviso (`origem` descartado) | `src/lib/pricing/carregar.ts:231` |
| N15 | Compra cria saldo em item sem controle de estoque | `src/app/compras/status-transicao.ts:182` |

Ruído menor que notei e não elevei a achado: `calcularAcabamentos` chama `calcularQtdBase` duas vezes por acabamento (`acabamento.ts:81-86`); `precificar.ts` mistura `contexto.custoEmbalagem ? …` (truthiness, M2/OFFSET) com `!== undefined` (demais branches) — sem efeito prático, mas é a mesma expressão escrita de dois jeitos em 6 lugares.

---

## 4. Já catalogados / já construídos com resíduo

**Já catalogados (confirmados ainda válidos no código, uma linha cada):**

- **A6/A7/A8 Parte 1** — sem motor por tempo de máquina, sem nesting em chapa rígida, M2 sem máquina/perda/vínculo com matéria-prima: confirmado, `carregar.ts:163-215` não carrega máquina nenhuma no branch M2.
- **A10/A11 Parte 1** — editorial multipágina e planificação de embalagem irrepresentáveis: confirmado, `PedidoOffset` só tem `larguraM`/`alturaM`.
- **A1/A2 Parte 2** — `SEQUENCIA_STATUS_PEDIDO` é array literal de 8 valores (`producao-estagios.ts:12`) e `CLICHE_FACA` é rótulo fixo.
- **B3/D1/D2 Parte 2** — sem refugo pós-produção, sem aprovação de qualidade, sem retorno de etapa: confirmado, `avancarStatusPedido` só faz `indice + 1`.
- **A1/A2/A5 Parte 3** — compras só de matéria-prima do catálogo, uma linha por solicitação, e nenhum vínculo com o financeiro: confirmado, `avancarStatusCompra` em RECEBIDO nunca cria `Despesa`.
- **A7 Parte 3** — recebimento tudo-ou-nada: confirmado, `quantidadeDec` vem inteira da solicitação.
- **A1/A2/A3 Parte 4** — `Despesa` × `CustoPedido` desconectados, overhead nunca confrontado, `saldoReal` mistura competência e caixa (`meu-negocio.ts` usa `Orcamento.createdAt` como data de receita).
- **A15 Parte 4** — sem conta bancária/caixa; nada atribuível a conta.
- **F2/F3/F4 Parte 7** — só NF-e de mercadoria, valor de frete inexistente no XML, estoque sem lote/validade.
- **A11 Parte 6** — `UnidadeDimensao` sem POLEGADA (a própria proposta recomenda não construir).

**Já construídos, com resíduo real:**

- **R1 — A7/Parte 4 (`CondicaoPagamento`, rodada 13):** `garantirCondicoesPagamentoPadrao` semeia 4 condições, mas `gerarContasReceberDaAprovacao` faz `if (condicao.ancora !== "APROVACAO") return;` — **3 das 4 sugestões padrão são inertes**, incluindo "1x faturado 30 dias" (`EMISSAO_NOTA`), que é a condição mais comum do mercado. A gráfica escolhe a condição no orçamento, aprova, e nenhuma `ContaReceber` nasce — sem erro, sem aviso na UI. O produto entrega defaults que não funcionam. `src/lib/condicao-pagamento.ts:33-66` e `:149`.
- **R2 — A3/Parte 5 (CFOP, rodada 5):** ver N7 — a dependência declarada (`indicadorInscricaoEstadual`) já foi construída na rodada 12 e `resolverCfop` não foi religado; o comentário no código ainda diz que o campo não existe.
- **R3 — E1/Parte 2 (terceirização, rodada 20):** `EtapaTerceirizada` registra envio, retorno, `notaRemessa`/`notaRetorno` e gera `CustoPedido` origem `TERCEIRIZACAO` — mas a emissão de NF-e tem `tipo_documento: "1"` e `finalidade_emissao: "1"` fixos (`focus-nfe.ts:321-322`) e o CFOP vem sempre de `cfopPadrao`/`cfopPadraoInterestadual`. Não há como emitir a remessa para industrialização (5901/6901) nem o retorno (5902/6902) que a própria proposta do achado cita como a forma fiscal da operação. Os campos `notaRemessa`/`notaRetorno` são texto para digitar o número de uma nota emitida **fora** do sistema.

---

## 5. Notas de método

- **Nenhum arquivo alterado.** Nenhum `Edit`/`Write`, nenhum comando de banco. Não rodou `tsc --noEmit` nem `vitest` — todos os achados confirmados por leitura de código e rastreamento de call-site, não por execução.
- **Não verificado a fundo:** (a) a suíte de testes existente (`src/lib/pricing/__tests__/*`, ~150 testes) — é possível que algum dos bugs de motor tenha um teste que *codifica* o comportamento atual como esperado, o que mudaria a leitura de "bug" para "decisão não documentada"; vale conferir antes de corrigir N3 e N9. (b) O módulo de billing/Stripe e a importação por IA (`src/lib/billing/*`, `src/lib/importacao/*`) — fora dos 7 domínios pedidos. (c) As telas React em profundidade.
- **Confiança por achado:** N1, N2, N3, N10, N14, N15, N16, N17 e R1/R2 são certezas de leitura direta. N4, N5, N6, N7, N8, N11, N12, N13 são certezas de código com julgamento de domínio na consequência de negócio. **N9 é o único com interpretação disputável** — a aritmética (`folhasAcerto × entradas²`) é fato; o que sustenta a leitura de "bug" é o texto de ajuda do próprio campo dizer "já descontado o acerto".
