# Auditoria de código — GrafPro (2026-09-12) — Parte 9

> Escopo: só os 10 commits de financeiro/produção construídos DEPOIS da Parte 8
> (`auditoria-codigo-2026-09-02.md`, fechada). Lente = "o que está ERRADO"
> (bug de lógica real), não "o que falta". Achados confirmados por leitura de
> diff + rastreamento de call-site; nenhum arquivo foi alterado.
> Numeração continua de N18 (Parte 8) → começa em **N19**.

## Resumo executivo

12 achados: **5 🔴** e **7 🟡**. Nada grave em Fiscal-A2 (validação de CPF/CNPJ) nem
em D3 (dados de pagamento) — os dois passaram limpos. O padrão dominante desta
rodada é o mesmo da Parte 8: **os defeitos moram nas bordas**. Três valores novos
(`OrigemCusto.DESPESA`, `StatusContaReceber.EM_COBRANCA`/`PERDA`) foram
introduzidos e plumbados em vários lugares, mas **não em todos os gêmeos** — cada
omissão dessas é um número errado em relatório ou um efeito colateral não desfeito.

---

## Achados 🔴

### N19 — O espelho `Despesa → CustoPedido` dobra um custo que já era automático (terceirização/compra), sem marcar `possivelDuplicidade` — **CONSTRUÍDO (commit c8b1ebe, 2026-09-12)**
- **Domínio:** Financeiro / Produção (Fin-A1, commit `08d3b10`)
- **Arquivo:** `src/lib/custo-pedido.ts:495-510`
- **Severidade:** 🔴 alta
- **Descrição:** `criarCustoAutomaticoDespesa` só checa duplicidade contra
  `origem: "MANUAL"` — não contra `TERCEIRIZACAO`, `COMPRA` nem `CONSUMO_ESTOQUE`.
  Cenário concreto, que é *literalmente o exemplo da mensagem do commit*: a gráfica
  terceiriza o verniz de um pedido por R$800. `EtapaTerceirizada` já dispara
  `criarCustoAutomaticoTerceirizacao` → `CustoPedido` #1 (R$800, origem
  TERCEIRIZACAO). Depois chega a nota do terceirizado e o financeiro lança a
  `Despesa` de R$800 vinculando ao pedido (exatamente o que a nova UI pede que ele
  faça) → `CustoPedido` #2 (R$800, origem DESPESA). O pedido passa a custar R$1.600
  em `lucroDoPedido`, e a DRE soma os dois em `custosVariaveis`. `possivelDuplicidade`
  fica **false** nos dois, então nem o aviso da UI aparece. Idem pra
  `SolicitacaoCompra` PEDIDO_ESPECIFICO + a `Despesa` daquela mesma compra.

### N20 — "O percentual de overhead que fecharia a conta" é calculado sobre a RECEITA, mas `overheadPercent` incide sobre o CUSTO — **CONSTRUÍDO (commit 8ccf512, 2026-09-12)**
- **Domínio:** Financeiro (Fin-A2, commit `0d7b695`)
- **Arquivo:** `src/lib/cobertura-overhead.ts:75`; texto em `src/app/financeiro/dre/page.tsx:222-228`
- **Severidade:** 🔴 alta
- **Descrição:** `percentualQueFecharia = custoFixoPago / receitaBruta * 100`. Mas
  `ParametrosGrafica.overheadPercent` é aplicado em `compor.ts:56` como
  `custoDireto × overheadPercent` — base **custo direto**, não receita. O card diz
  ao dono, em texto direto: "o percentual de overhead que fecharia a conta é X%",
  e ele vai digitar X em Configurações. Cenário concreto: custo fixo pago R$30.000,
  receita R$100.000, custo direto agregado R$40.000. O card mostra **30%**;
  configurar 30% gera R$12.000 de overhead cobrado, não R$30.000 — o correto seria
  75%. O erro é sempre **para baixo** (custoDireto < receita), ou seja, empurra a
  gráfica a subprecificar exatamente quando o relatório acusou descoberta.

### N21 — `EM_COBRANCA` entrou nas queries de "em aberto" mas não nos ramos que calculam SALDO → conta parcialmente recebida aparece pelo valor CHEIO — **CONSTRUÍDO (commit 258d352, 2026-09-12)**
- **Domínio:** Financeiro (Fin-A5, commit `ec02d7b`)
- **Arquivo:** `src/lib/exportacao-financeira-query.ts:177` vs `:240`; `src/lib/historico-cliente.ts:85` vs `:114`
- **Severidade:** 🔴 alta
- **Descrição:** Os dois arquivos foram widened no `where` (`status in [PENDENTE,
  PARCIAL, EM_COBRANCA]`) mas o ramo que decide se precisa calcular saldo continuou
  `c.status === "PARCIAL" ? saldoContaReceber(...) : valor cheio`. `EM_COBRANCA` cai
  no `else`. Cenário concreto: conta de R$10.000 com R$7.000 já recebidos (status
  PARCIAL), o financeiro marca "em cobrança" pra perseguir os R$3.000 restantes —
  status vira EM_COBRANCA e, a partir daí, **a exportação pro contador e o histórico
  do cliente passam a mostrar R$10.000 em aberto** em vez de R$3.000. Silencioso, e
  justamente nas duas telas onde o número é lido como verdade.
  (`exposicao-credito-cliente.ts:43` fez certo — colocou EM_COBRANCA no bucket de
  saldo calculado. É o gêmeo que prova que os outros dois estão errados.)

### N22 — `cancelarPedido` só estorna `CustoPedido` vindo de estoque; comissão, terceirização, compra e (agora) despesa ficam ativos — e a DRE não filtra pedido cancelado no custo variável — **CONSTRUÍDO (2026-09-12)**
- **Domínio:** Produção / Financeiro (interação A12 `4dd9327` + Fin-A1 `08d3b10`)
- **Arquivo:** `src/app/producao/actions.ts:428-431`; `src/lib/dre-query.ts:58-66`
- **Severidade:** 🔴 alta
- **Descrição:** O estorno de custos em `cancelarPedido` filtra
  `{ movimentacaoEstoqueId: { in: saidas } }` — só os custos derivados de baixa de
  estoque. `CustoPedido` de origem `COMISSAO`, `TERCEIRIZACAO`, `COMPRA` e o novo
  `DESPESA` continuam com `estornadoEm: null`. Do outro lado, `buscarDRE` filtra
  `semPedidoCancelado` na **receita** mas **não** no agregado de `custosVariaveis`.
  Cenário concreto: pedido de R$20.000 com terceirização de R$3.000 é cancelado. A
  receita some da DRE (correto), a `Comissao` é cancelada (A12, correto), mas o
  `CustoPedido` de R$3.000 continua somando em `custosVariaveis` do mês — resultado
  do mês cai R$3.000 sem nenhuma receita correspondente. Agrava com Fin-A1: agora
  também dá pra vincular uma `Despesa` nova a um pedido **já cancelado**
  (`resolverPedidoDespesa` não checa status) e gerar um espelho ativo nele.
- **Decisão do dono (2026-09-12):** só reverte o que ainda não foi
  incorrido. Aplicado: `CustoPedido` origem `COMISSAO` estorna junto quando
  a `Comissao` ainda está PENDENTE (mesmo critério já usado pra cancelar a
  própria `Comissao`); origem `DESPESA` estorna só quando a `Despesa`
  vinculada ainda está PENDENTE (PAGA/PARCIAL ficam intactas — dinheiro que
  já saiu não é revertido sozinho). `TERCEIRIZACAO`/`COMPRA` NUNCA são
  estornadas por `cancelarPedido`, de propósito — por construção, só nascem
  DEPOIS que o serviço já foi prestado (`valorFinal` preenchido) ou o
  material já chegou (`RECEBIDO`), ou seja, já incorridas no momento em que
  existem. `buscarDRE` ganhou `semPedidoCancelado` no agregado de
  `custosVariaveis` (independente do estorno — filtra pelo PEDIDO, não só
  por `estornadoEm`). `resolverPedidoDespesa` passou a rejeitar vincular
  uma Despesa NOVA a um pedido cancelado (edições que só mantêm um vínculo
  já existente continuam permitidas). Ver `src/app/producao/actions.ts`,
  `src/lib/dre-query.ts`, `src/app/financeiro/actions.ts`.

### N23 — Marcar uma conta como `PERDA` libera o limite de crédito do caloteiro e não vira perda em lugar nenhum — **CONSTRUÍDO (2026-09-12)**
- **Domínio:** Financeiro (Fin-A5, commit `ec02d7b`)
- **Arquivo:** `src/lib/exposicao-credito-cliente.ts:33-44`; `src/lib/dre-query.ts` (nenhuma linha — é a ausência)
- **Severidade:** 🔴 alta
- **Descrição:** `PERDA` não aparece em `calcularExposicaoCreditoCliente` (que só
  soma PENDENTE/PARCIAL/EM_COBRANCA) e não existe em nenhuma linha da DRE. Cenário
  concreto: cliente deu calote de R$50.000 e tem limite de crédito de R$50.000. O
  financeiro reconhece o calote marcando `PERDA` — **a exposição dele volta a zero
  e `bloqueiaAoUltrapassarLimiteCredito` para de bloquear**: o caloteiro
  reconhecido pelo próprio sistema pode comprar R$50.000 a prazo de novo, no dia
  seguinte. E como `receitaBruta` da DRE é competência (`Orcamento.total` aprovado)
  e nada subtrai a perda, o resultado líquido do período **continua contando os
  R$50.000 como se tivessem entrado**. O write-off só move a conta pra fora de
  todos os relatórios, sem registrar o prejuízo em nenhum deles.
- **Decisão do dono (2026-09-12):** `PERDA` deve reconhecer o calote, mas
  NÃO liberar limite de crédito sozinha — precisa de revisão manual.
  Aplicado: `ContaReceber` ganhou `perdaEm` (carimbado junto com o
  write-off, usado por `buscarDRE` pra reconhecer o prejuízo no período
  certo) e `limiteLiberadoEm` (null até um humano revisar). Nova linha na
  DRE "(−) Perdas com inadimplência", soma o SALDO (não o valor cheio — uma
  baixa parcial recebida antes do write-off continua contando).
  `calcularExposicaoCreditoCliente` passou a somar `PERDA` com
  `limiteLiberadoEm: null`. Nova ação `liberarLimiteContaReceberPerda`
  (`src/app/financeiro/contas-receber/actions.ts`), separada do write-off,
  com botão próprio em `ContaReceberLinha.tsx`. Migration aditiva
  (`20260912140000_conta_receber_perda_limite_liberado`).

---

## Achados 🟡

### N24 — Cancelar pedido não cancela `ContaReceber` em `EM_COBRANCA` (mesmo buraco do N2 da Parte 8, por um status novo)
- **Domínio:** Produção / Financeiro (Fin-A5 × correção do N2)
- **Arquivo:** `src/app/producao/actions.ts:454-456`
- **Severidade:** 🟡 média
- **Descrição:** O bloco corrigido na Parte 8 cancela só `status: "PENDENTE"`. Uma
  conta vencida que o financeiro marcou como "em cobrança" e o pedido depois é
  cancelado fica `EM_COBRANCA` pra sempre — volta a entrar no aging, na exposição
  de crédito, na projeção de fluxo de caixa e na exportação pro contador, de um
  pedido que não existe mais. O comentário do próprio bloco explica por que
  `PARCIAL` fica de fora (tem dinheiro real recebido); `EM_COBRANCA` sem nenhuma
  baixa não tem essa justificativa — só foi esquecido.

### N25 — Pagamento lançado na tela do orçamento nunca concilia com conta `EM_COBRANCA`
- **Domínio:** Financeiro (Fin-A5)
- **Arquivo:** `src/app/orcamento/[id]/actions/pagamentos.ts:205` e `:233`
- **Severidade:** 🟡 média
- **Descrição:** A conciliação automática procura candidata em `status: "PENDENTE"`
  (match por valor total) e, no fallback, em `status: "PARCIAL"` (match por saldo).
  `EM_COBRANCA` não entra em nenhum dos dois. Cenário concreto: conta vencida
  marcada "em cobrança", o cliente enfim paga, o vendedor registra o pagamento na
  tela do orçamento (caminho mais usado) — o `Pagamento` é criado, mas a conta fica
  `EM_COBRANCA` aberta indefinidamente. Ironicamente é a conta com **maior**
  probabilidade de ser paga fora do fluxo normal que deixa de conciliar.

### N26 — Retorno de etapa por "erro de arte" não invalida a aprovação de arte do cliente
- **Domínio:** Produção (interação Prod-D2 `d16dc0a` × gates de arte)
- **Arquivo:** `src/app/producao/retorno-etapa-actions.ts:110-140`; gates em `src/app/producao/status-transicao.ts:571` e `:587`
- **Severidade:** 🟡 média
- **Descrição:** `MotivoRetorno.ERRO_ARTE` existe justamente pro caso "erro de arte
  identificado depois de produzir", e `retornarEtapa` manda o pedido de volta pra
  ARTE. Mas `Pedido.arteAprovadaEm` e `ArteItem.aprovadaEm` **continuam preenchidos**
  — `retornarEtapa` não os zera. Os dois gates de arte em `avancarStatusPedido`
  olham exatamente esses campos, então o pedido sai de ARTE de novo num clique, com
  a arte NOVA nunca vista pelo cliente, carimbada como aprovada por ele. O contraste
  é o que torna isto um bug e não uma decisão: o Prod-D1 amarrou de propósito a
  aprovação de qualidade ao `ApontamentoEtapa` da passagem atual "pra retrabalho não
  herdar aprovação de rodada anterior" — o gate de arte herda.

### N27 — Uma `RegraComissao` genérica (todos os filtros vazios) derruba `Usuario.comissaoPercent` de todo mundo e fura o opt-in do vendedor sem cadastro
- **Domínio:** Financeiro (A12, commit `4dd9327`)
- **Arquivo:** `src/lib/comissao-aprovacao.ts:162-171`; especificidade em `src/lib/comissao.ts:~100`
- **Severidade:** 🟡 média
- **Descrição:** A cascata é `if (regraResolvida) → else if (usuarioAlvo) → else`.
  Uma regra com **especificidade 0** (nenhum filtro preenchido, ex: "5% padrão")
  ainda "bate" e vence, então `Usuario.comissaoPercent` só é consultado quando
  **nenhuma** regra bate. Cenário concreto: a gráfica tem 3 vendedores com 3%, 5% e
  8% cadastrados individualmente há meses; o dono cria uma regra geral de 5% pra
  cobrir os representantes externos — **os três passam a receber 5%**, sem aviso, no
  próximo orçamento aprovado. O mesmo caminho também fura o opt-in documentado de
  vendedor sem cadastro: `comissaoRepresentanteSemCadastroPercent` continua null,
  mas a regra genérica (usuarioId=null) casa com `usuarioAlvo=null` e passa a gerar
  `Comissao` pra todo `Orcamento.vendedor` texto-livre.

### N28 — `ordem` de cronograma de entrega = contagem atual, sem renumerar na remoção, contra um `@@unique` → P2002 não tratado
- **Domínio:** Orçamento (B3, commit `632aa62`)
- **Arquivo:** `src/app/orcamento/[id]/actions/entrega-programada.ts:88`; `prisma/schema/09-orcamento.prisma:870` (`@@unique([orcamentoId, ordem])`)
- **Severidade:** 🟡 média
- **Descrição:** `ordem = _count.entregasProgramadas` e `removerEntregaProgramadaOrcamento`
  não renumera ninguém. Cenário concreto: vendedor cadastra 3 parcelas (ordem 0,1,2),
  remove a primeira (sobram 1 e 2), adiciona uma nova → `_count` = 2 → tenta gravar
  `ordem: 2`, que já existe → violação de unicidade lançada crua de dentro da server
  action, sem `try/catch` (compare com o cuidado de `ehViolacaoDeUnicidade` em
  `despesa-recorrente.ts:149`). O usuário leva um erro de aplicação num fluxo trivial.

### N29 — Cronograma de entrega é validado só na escrita; mudar os itens do orçamento depois deixa a promessa acima do vendido
- **Domínio:** Orçamento (B3)
- **Arquivo:** `src/lib/orcamento-entrega-programada.ts:35-50`; consumo em `src/lib/pdf/mapear-dados.ts` e `src/app/o/[token]/page.tsx`
- **Severidade:** 🟡 média
- **Descrição:** `validarSomaCronogramaEntrega` roda em `adicionar`/`editar` da linha
  de cronograma, nunca na edição dos itens do orçamento. Cenário concreto: 12.000
  unidades vendidas, cronograma de 6 × 2.000 cadastrado; o cliente reduz pra 6.000 e
  o vendedor ajusta a quantidade do item — o cronograma continua com 12.000, e o PDF
  e o link público `/o/[token]` continuam imprimindo um compromisso contratual de
  entregar o dobro do que foi vendido. Some-se a isso que `somarQuantidadeItensBase`
  soma `quantidade` de itens heterogêneos (1.000 cartões + 500 panfletos = "1.500"),
  então a referência de validação já é um número sem significado em orçamento
  multi-linha.

### N30 — Item precificado pelo modelo SIMPLES entra na receita do card de overhead mas contribui 0 de overhead cobrado
- **Domínio:** Financeiro (Fin-A2)
- **Arquivo:** `src/lib/cobertura-overhead-db.ts:63-70` e `:85-100`
- **Severidade:** 🟡 média
- **Descrição:** `overheadCobrado` vem de `OrcamentoItem.breakdown.detalhes.overhead`,
  que só existe pro motor avançado (`comporPreco`). Item SIMPLES não tem breakdown e
  conta 0 — mas o `precoTotal` dele **entra inteiro** na `receitaBruta` do mesmo
  cálculo. Cenário concreto: gráfica que vende majoritariamente por tabela (SIMPLES)
  abre o DRE e vê "Seu overhead cobriu R$ 0,00, seu custo fixo real foi R$ 28.000 —
  overhead cobrado NÃO cobriu o custo fixo real", com tile em tom de alerta. O
  relatório está medindo cobertura de um mecanismo que aquela gráfica não usa, sem
  dizer isso em lugar nenhum da tela.

### N31 — Juros/multa recebidos entram na DRE mas não no caixa: `Pagamento.valor` continua limitado ao saldo do principal
- **Domínio:** Financeiro (Fin-A5)
- **Arquivo:** `src/app/financeiro/contas-receber/actions.ts:259-292`; consumo em `src/lib/dre-query.ts:88-95`
- **Severidade:** 🟡 média
- **Descrição:** `registrarBaixaContaReceber` rejeita `valor > saldoAtual`, então o
  usuário é obrigado a lançar o principal em `valor` e os juros/multa nos campos
  novos. `Pagamento.valorJuros`/`valorMulta` só são lidos pela DRE (linha "Receita
  financeira"). Cenário concreto: conta de R$5.000 paga com R$300 de juros — o
  cliente depositou R$5.300, mas `/meu-negocio`, a projeção de fluxo de caixa e
  qualquer leitura de `Pagamento.valor` enxergam R$5.000. Só a DRE vê os R$300, e a
  divergência entre os dois relatórios não é explicada em nenhum dos dois.

---

## Passaram limpos

- **Fiscal-A2 Fase A (`90e712d`)** — `documento.ts` está correto (inclusive a
  comparação normalizada-vs-normalizada em `atualizarCliente`, que de fato evita
  travar documento legado sujo). Nada a reportar.
- **D3 (`b3996ff`)** — gate de `FINANCEIRO` re-derivado no servidor, auditoria sem
  valor sensível, `Comissao.usuario` nullable já tratado em
  `comissoes/page.tsx:96-100`. Nada a reportar.
- **Prod-D1 (`8137503`)** — a trava de passagem (aprovação amarrada ao
  `ApontamentoEtapa` aberto) está certa e o fallback sem apontamento só alcança dado
  anterior ao B1/B2, já que `abrirApontamentoInicialSeNecessario` roda na aprovação.
- **Prod-D2 / baixa dupla (`d16dc0a`)** — a trava `!pedido.baixaEstoqueRealizadaEm`
  está correta e os 3 call-sites (`avancarPedido`, `confirmarEstagioPublico`,
  `avancarStatusQr`) buscam o `Pedido` com `include`, nunca `select`, então o escalar
  sempre viaja: o `?` no tipo não vira `undefined` na prática. O único problema deste
  commit é o N26 acima.
