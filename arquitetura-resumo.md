# Mapa condensado de arquitetura — GrafPro

> **Propósito:** este arquivo é um mapa DENSO da arquitetura atual do GrafPro,
> escrito pra um subagente de pesquisa (auditoria de abrangência, ver
> `pesquisa-abrangencia-modulos.md`) ler ANTES de explorar o repo — não é
> documentação de produto nem material didático. Leia isto primeiro; só abra
> `prisma/schema.prisma` ou o código de verdade pra confirmar um detalhe
> específico que este mapa não cobre ou que pode ter mudado.
>
> **Última atualização:** 2026-08-30. `prisma/schema.prisma` tinha 4535
> linhas nesta data. Se o schema tiver crescido muito além disso, trate este
> mapa como desatualizado e prefira reconferir enums/models críticos no
> arquivo real antes de citar valores exatos.
>
> **O que é o GrafPro:** SaaS multi-tenant (Next.js 16 App Router + Server
> Actions, Prisma 7, PostgreSQL/Neon) pra gráficas brasileiras. Cada
> `Grafica` é um tenant isolado (`graficaId` em quase toda tabela). Cliente-
> piloto em produção real: Assus Graphics (rótulos/etiquetas), mas o produto
> é vendido pra centenas de gráficas de perfis diferentes (offset comercial,
> comunicação visual, estamparia, brindes, embalagem, editorial, corte a
> laser, gráfica rápida...).

---

## Índice

1. [Padrões arquiteturais estabelecidos](#1-padrões-arquiteturais-estabelecidos) — leia isto primeiro, vale pra todo domínio
2. [Catálogo / Motor de Preço](#2-catálogo--motor-de-preço)
3. [Orçamento](#3-orçamento)
4. [Produção](#4-produção)
5. [Financeiro](#5-financeiro)
6. [Compras](#6-compras)
7. [Clientes / Fiscal](#7-clientes--fiscal)
8. [Configurações](#8-configurações)
9. [Auth / Billing / Infra transversal](#9-auth--billing--infra-transversal)

---

## 1. Padrões arquiteturais estabelecidos

Estes padrões se repetem em praticamente todo domínio abaixo — confirmados
no código, não inventados:

- **Multi-tenant sempre por `graficaId`.** Toda query filtra/valida
  `graficaId` contra a sessão antes de mutar (ex:
  `where: { id: itemGraficaId, graficaId: usuario.graficaId }` em
  `src/app/catalogo/[itemGraficaId]/actions.ts`). Nunca confia em
  `graficaId` vindo do client.
- **Migration aditiva-só.** Nunca remove/renomeia coluna existente sem
  plano de coexistência (confirmado no changelog de
  `pesquisa-abrangencia-modulos.md`: "migration aditiva aplicada..." se
  repete a cada rodada). Campo novo nasce nullable ou com `@default` que
  preserva 100% o comportamento anterior — o comentário do campo costuma
  dizer isso explicitamente.
- **Enum-fechado + `OUTRO` de escape.** Padrão dominante pra lista fechada
  que descreve o mundo real (materiais, processos, origens, segmentos): o
  enum tem `OUTRO` + campo texto irmão (`xxxOutro`), obrigatório só quando
  o enum = `OUTRO` (validado na Server Action, nunca `CHECK` no banco).
  Dezenas de ocorrências (`UnidadeMedida`, `MaterialSubstrato`,
  `OrigemCliente`, `SegmentoGrafica`, `CategoriaEquipamento`,
  `UnidadeCompra`, `OrigemSolicitacaoCompra`...).
  **Fechados sem `OUTRO`** (razão no comentário do schema):
  `RegimeTributario` (só 3 regimes reais no Brasil), `TipoPessoa`
  (FISICA/JURIDICA, sem 3º tipo), `TipoEnderecoCliente` (3 papéis fixos,
  não lista aberta), `IndicadorInscricaoEstadual`/`TipoFrete` (tags fixas
  da NF-e 4.0), `TipoRotulagem` (processo binário, não catálogo).
- **Saldo sempre calculado, nunca armazenado.** `CreditoCliente` e
  `ContaReceber`/`Despesa` (parcial) nunca guardam campo `saldo` — é
  sempre soma de movimentações/baixas recalculada em runtime dentro da
  mesma transação que consome (`credito-cliente.ts:saldoCreditoCliente`,
  `baixa-financeira.ts:saldoContaReceber/saldoDespesa`) — evita corrida de
  cache permitindo consumir mais do que existe. Exceção deliberada:
  `ContaPrepaga.saldoAtual` É cache (atualizado na mesma transação),
  aceito porque a carteira externa (ex: Lalamove) não tem a mesma pressão
  de corrida.
- **Snapshot em aprovação, nunca recalculado depois.** Na aprovação do
  `Orcamento`, congela-se: `Comissao` (taxa + política do momento),
  `Pedido.precoSugeridoTotal/valorNegociadoTotal/custoPrevistoTotal`,
  `PedidoCustoPrevisto`, `ContaReceber` gerada de `CondicaoPagamento`,
  `FilaGangRun` — nada disso se recalcula se a config mudar depois. Mesmo
  princípio no preço em si: `OrcamentoItem.precoUnitario/precoTotal` é o
  valor VENDIDO travado; o motor só sugere (`precoSugeridoUnitario`).
  `Orcamento.validoAteEm`/`toleranciaTiragemPercent` são snapshot do ENVIO
  (não da aprovação).
- **Split `-db.ts` pra não vazar Prisma pro bundle do Client Component.**
  Função PURA importada por Client Component mora em arquivo sem sufixo
  (`comparativo-fornecedores.ts`); as que tocam Prisma ficam num irmão
  `-db.ts` (`comparativo-fornecedores-db.ts`, `import "server-only"`).
  Confirmado: `NovaSolicitacaoForm.tsx` (`"use client"`) importa
  `chaveComparativo` do arquivo puro. Outros pares: `catalogo-reajuste`,
  `contrato-fornecimento`, `cotacao-fornecedor`, `previsao-estoque`.
- **CAS em toda transição de status.** Nunca `update` direto — sempre
  `updateMany({ where: { id, status: statusAnterior }, data: { status:
  proximo } })` + checa `count === 0` pra lançar erro de corrida (dois
  cliques simultâneos). Ver `producao/status-transicao.ts`,
  `orcamento-status.ts`, `compras-status.ts`, `entrega-status.ts`.
- **"Tudo sensível no backend."** Preço, permissão, dono de registro nunca
  confiados no cliente; toda Server Action re-deriva da sessão
  (`exigirUsuarioAutenticado`, `usuario.graficaId`). Motor de preço sempre
  recalcula do zero no servidor.
- **Configurabilidade em vez de hardcode.** Unidade, categoria de custo,
  condição de pagamento, feriado — sempre cadastro configurável por
  gráfica (`CategoriaCusto`, `CondicaoPagamento`, `FeriadoGrafica`), nunca
  constante fixa, com "pacote padrão sugerido" bootstrap lazy na primeira
  vez (`garantirCategoriasCustoPadrao`, `garantirCondicoesPagamentoPadrao`).
- **FK opcional + snapshot em texto lado a lado.** Quando cadastro
  estruturado chega depois de campo texto livre: a FK nova é opcional e só
  PRÉ-PREENCHE o texto — o texto continua sendo lido por PDF/link
  público/produção, nunca a FK direto (protege contra edição/desativação
  posterior do cadastro). Ex: `contatoClienteId`+`contatoNome/Email`,
  `enderecoEntregaId`+`localEntrega`, `condicaoPagamentoId`+
  `condicoesPagamento`.
- **Soft-delete quase universal.** `desativadoEm`/`ativo`/`ativa` em vez
  de hard delete sempre que o registro pode ser referenciado por
  histórico (Usuario, Cliente, ContatoCliente, EnderecoCliente,
  CategoriaCusto, CondicaoPagamento, Fornecedor, VarianteMateriaPrima).
  `desativadoEm` é `DateTime?` (não `Boolean`) quando "quando saiu"
  importa pra investigação.
- **`onDelete` como decisão documentada campo a campo.** `Restrict`
  quando apagar o pai destruiria histórico/travaria produto em uso (ex:
  `ItemGrafica.prensaId`); `SetNull` quando o neto deve sobreviver (ex:
  `RegistroManutencao`→máquina); `Cascade` só quando o filho não existe
  sem o pai (`OrcamentoItem`→`Orcamento`).
- **Texto livre + par estruturado opcional** (`categoria` de Despesa,
  `condicaoPagamento` de compra) — nunca fecha um enum sem uso real
  validado ("hardcode prematuro"); o texto livre nunca é removido.
- **`server-only` em todo `src/lib/*.ts` que toca Prisma** — erro de
  build se um Client Component importar por engano.

---

## 2. Catálogo / Motor de Preço

### Models principais

- **`ItemCatalogo`** — catálogo mestre (`graficaId=null`, via seed) +
  itens privados por gráfica (`graficaId` preenchido). `tipo`:
  `TipoItemCatalogo` (PRODUTO/MATERIA_PRIMA/SERVICO). Campos-chave:
  `categoria` (string livre), `unidade` (`UnidadeMedida?` + `unidadeOutro`),
  `ncm` (fiscal).
- **`ItemGrafica`** — a "adoção" de um `ItemCatalogo` por uma gráfica:
  preço de compra/venda, estoque (`estoqueAtual/estoqueMinimo`), e todo o
  roteamento pro motor avançado via `modeloCalculo` (`ModeloCalculo`).
  Campos-chave por modelo:
  - `SIMPLES`: só `precoVenda` direto.
  - `OFFSET`: `prensaId`, `papelId` (aponta pra outro `ItemGrafica` que é
    matéria-prima papel), `gramaturaGm2`, `viraFolha` (work-and-turn).
  - `M2`: `custoImpressaoM2`, `areaMinimaFaturavel`.
  - `FLEXOGRAFIA`: `maquinaFlexografiaId`.
  - `DIGITAL`: `impressoraDigitalId`.
  - `SERIGRAFIA`/`SUBLIMACAO`/`ESTAMPAGEM_QUENTE`/`PERSONALIZACAO`:
    `maquinaSetupPorPecaId` (a máquina precisa ter `ProcessoSetupPorPeca`
    compatível, validado em app).
  - `REVENDA`: sem máquina — custo = `Q × custoAquisicaoUnitario`.
  Também carrega: `categoriaCustoId` (pra onde a baixa automática de
  matéria-prima cai), `unidadeContagem`/`fatorConversao` (unidade de
  RACIOCÍNIO/venda, ex: milheiro), campos de compra (`unidadeCompraPadrao`,
  `fatorConversaoCompraPadrao`, `loteMinimoCompra`, `multiploCompra`),
  `perdaFixaPadrao` (perda de calibragem, fixa por entrada em produção,
  distinta de `Prensa.perdaPercentPadrao` que só entra na ESTIMATIVA).
- **`TabelaPrecoPapel`** — preço por gramatura de um papel
  (`itemGraficaId + gramatura → precoKg`), com fallback pra gramatura mais
  próxima (`resolverPrecoPapel`).
- **`FichaTecnicaItem`** — consumo de matéria-prima por unidade vendida de
  um produto (`itemGraficaId` produto → `materiaPrimaId` consumida,
  `quantidadePorUnidade`), alimenta baixa automática de estoque.
  `varianteId` opcional quando a matéria-prima tem `VarianteMateriaPrima`.
- **`VarianteMateriaPrima`** — sub-variação de uma matéria-prima com
  estoque/preço PRÓPRIOS (ex: espessura de chapa 2mm/3mm/5mm) — diferente
  de `TabelaPrecoPapel` (que só varia preço, não estoque).
- **`BobinaMaterial`** — opções de largura de bobina de um material
  (`larguraNominal`, `refile`), usado no nesting 2D do Offset.
- **`FormatoFolha`** — formatos de folha de máquina de um papel
  (`larguraFolha × alturaFolha`).
- **`ConfiguracaoAcabamento`** — configura um `SERVICO` como acabamento
  (`baseCobranca`: `BaseCobranca`; `estagio`: PRE_REFILE/POS_REFILE;
  `custoSetup`, `custoMinimo`, `custoFerramental`).
- **`ConfiguracaoClicheEtiqueta`** — motor de clichê opcional pra M2
  (presença da linha = ligado), `custoClichePorCm2`.
- **`ConfiguracaoClicheFlexografia`** — mesmo cálculo, mas OBRIGATÓRIO
  pra todo produto FLEXOGRAFIA (tabela paralela, não reaproveitada).
- **`ConfiguracaoEmenda`** — permite emendar painéis maiores que a bobina
  em produtos M2 (`custoPorMetroLinear`, `sobreposicaoM` informativo);
  presença da linha = liberado. Sem isso, `calcularM2` lança
  `PECA_EXCEDE_BOBINA`.
- **`MovimentacaoEstoque`** — toda entrada/saída de estoque.
  `TipoMovimentacao`: `SAIDA_PRODUCAO`, `ESTORNO_CANCELAMENTO`,
  `ENTRADA_COMPRA`, `SAIDA_MANUAL`, `AJUSTE_INVENTARIO`. Snapshot de custo
  (`custoUnitario`, `custoTotal`, `metodoCusteio`: `MetodoCusteio` —
  PRECO_CADASTRO/ULTIMA_COMPRA/MEDIO_PONDERADO, só o primeiro implementado)
  — nunca recalculado retroativamente.
- **Máquinas físicas (tabelas paralelas, não polimórficas — decisão
  deliberada, ver comentário em `MaquinaFlexografia`):** `Prensa` (offset:
  `custoHoraMaq`, `torres`, `custoChapa`, `folhasAcerto`, `tempoAcertoH`,
  `custoMilheiroRod`, `rodagemMinima`, `perdaPercentPadrao`),
  `MaquinaFlexografia` (`larguraMaquinaM`, `passoCilindroM`,
  `numeroEstacoesCores`, `metrosAcerto`, `custoMetroLinearRod`),
  `ImpressoraDigital` (`custoPorClique`, sem nesting),
  `MaquinaSetupPorPeca` (`tipoProcesso`: `ProcessoSetupPorPeca`,
  `custoPorSetup`, `custoPorPeca`, `custoMinimo`).
- **`Equipamento`** — equipamento SEM motor de custo próprio (guilhotina,
  laminadora, CTP etc.) — puramente cadastro + rastreio de manutenção,
  nunca influencia preço. `categoria`: `CategoriaEquipamento`.
- **`RegistroManutencao`** — período de indisponibilidade de UMA das 5
  máquinas (Prensa/MaquinaFlexografia/Equipamento/ImpressoraDigital/
  MaquinaSetupPorPeca — exatamente 1 FK preenchida, validado em app).
  `tipo`: `TipoRegistroManutencao` (PREVENTIVA/QUEBRA). `dataFim=null` =
  parada em andamento.

### Enums

- `TipoItemCatalogo`: PRODUTO, MATERIA_PRIMA, SERVICO.
- `ModeloCalculo`: SIMPLES, M2, OFFSET, FLEXOGRAFIA, DIGITAL, SERIGRAFIA,
  SUBLIMACAO, ESTAMPAGEM_QUENTE, PERSONALIZACAO, REVENDA. (SERIGRAFIA/
  SUBLIMACAO/ESTAMPAGEM_QUENTE/PERSONALIZACAO compartilham a MESMA função
  `calcularSetupPorPeca` — só o rótulo no dropdown difere.)
- `ProcessoSetupPorPeca` (fechado + OUTRO): SERIGRAFIA, SUBLIMACAO,
  ESTAMPAGEM_QUENTE, TAMPOGRAFIA, GRAVACAO_LASER, DTG, TRANSFER, OUTRO.
- `BaseCobranca`: UNIDADE, M2, FOLHA_IMPRESSA, METRO_LINEAR, FIXO, HORA,
  MILHEIRO, CENTO. (fechado, sem OUTRO — é uma fórmula de cobrança, não um
  catálogo de material)
- `EstagioAcabamento`: PRE_REFILE, POS_REFILE.
- `UnidadeMedida` (fechado + OUTRO): FOLHA, METRO_QUADRADO, METRO_LINEAR,
  UNIDADE, LITRO, KG, ROLO, PACOTE, CENTO, MILHEIRO, HORA, OUTRO.
- `UnidadeCompra` (fechado + OUTRO): FARDO, RESMA, BOBINA, ROLO, PALETE,
  CAIXA, UNIDADE, KG, TONELADA, OUTRO. Distinta de `UnidadeMedida`: esta é
  a unidade COMERCIAL de compra (NF-e distingue uCom de uTrib).
- `CategoriaEquipamento` (fechado + OUTRO): GUILHOTINA, LAMINADORA,
  DOBRADEIRA, ENCADERNADORA, GRAMPEADEIRA, PLOTTER_RECORTE,
  IMPRESSORA_GRANDE_FORMATO, CTP, IMPRESSORA_DIGITAL, SERIGRAFIA,
  SUBLIMACAO, ESTAMPAGEM_QUENTE, CORTE_LASER_ROUTER, OUTRO.
- `TipoRegistroManutencao`: PREVENTIVA, QUEBRA.
- `TipoMovimentacao`: SAIDA_PRODUCAO, ESTORNO_CANCELAMENTO,
  ENTRADA_COMPRA, SAIDA_MANUAL, AJUSTE_INVENTARIO.
- `MetodoCusteio`: PRECO_CADASTRO, ULTIMA_COMPRA, MEDIO_PONDERADO.

### Arquivos-chave

- `src/lib/pricing/precificar.ts` — orquestrador central (`ContextoPrecificacao`, gancho `margemLucroOverride` pro segmento de cliente).
- `src/lib/pricing/compor.ts` — composição final de preço (overhead, margem, imposto, comissão, taxa financeira, arredondamento) — comum a TODOS os modelos, inclusive REVENDA.
- `src/lib/pricing/{m2,offset,flexografia,digital,setup-por-peca,revenda,acabamento,papel}.ts` — um arquivo por modelo de cálculo.
- `src/lib/pricing/carregar.ts` — carrega contexto (máquinas, papel, bobinas) do banco pro motor puro; `validar.ts`, `erros.ts`, `tipos.ts`, `decimal.ts` — validação/tipos/Decimal.
- `src/app/catalogo/[itemGraficaId]/actions.ts` — CRUD de produto/matéria-prima + config de motor (bobinas, formatos, clichê, emenda). `ConfiguracaoEmendaForm.tsx` é UI nova (não commitada na sessão atual — ver `git status`).
- `src/lib/manutencao-maquina.ts` — `buscarManutencoesAtivas`, `validarSelecaoMaquina(Opcional)`; `apontamento-etapa.ts` (ver Produção).
- `src/lib/catalogo-reajuste.ts`/`-db.ts` (reajuste em lote), `catalogo-ncm.ts` (validação NCM).
- `src/lib/estoque-critico.ts`, `alerta-estoque.ts` — estoque baixo, dedup via `alertaEstoqueEnviadoEm`.
- `src/lib/tipos-equipamento.ts`, `unidade.ts`, `unidade-compra.ts`, `unidade-contagem.ts`, `unidade-dimensao.ts` — helpers de enum/conversão.

---

## 3. Orçamento

### Models principais

- **`Orcamento`** — status `StatusOrcamento` (RASCUNHO/ENVIADO/APROVADO/
  REJEITADO). Campos-chave: `total` (cache), `linkPublicoToken` (link
  público `/o/[token]`), `filialId`, `tipoPedido` (`TipoPedidoOrcamento`),
  contato/endereço (FK opcional + snapshot texto, ver padrão #1),
  `condicaoPagamentoId` + `condicoesPagamento` (texto), `frete`
  (`TipoFrete`), `validoAteEm`/`toleranciaTiragemPercent` (snapshot no
  ENVIO), `enviadoEm` (âncora de "orçamento parado"), `arteUrl` +
  `preflightAvisos` (Json — achados de DPI/sangria), campos de etapa
  manual (`etapaOrcamentoDesenvolvimentoEm/Responsavel`, `etapaLayoutEm`,
  `etapaAprovacaoEm`, `etapaConfirmacaoPedidoEm`, `etapaEntregaEm` — texto
  livre, não FK Usuario), `duplicadoDeId` (rastreio "Pedir de novo"),
  `opcaoEscolhidaNome` (snapshot da opção escolhida, ver `OrcamentoOpcao`),
  `notaEmpenho`/`processoLicitatorio` (órgão público), `respostaPublicaNome/
  Em/Motivo` (aceite/recusa pelo cliente, nome DECLARADO não verificado).
- **`OrcamentoOpcao`** — proposta alternativa dentro do MESMO orçamento
  (ex: "Pacote Econômico" vs "Premium"). Opção-base = itens com
  `opcaoId=null` (sempre existiu, sem migração). Máx. 2 alternativas + base
  = 3 total. Na aprovação, a escolhida é PROMOVIDA (`opcaoId` zerado nos
  itens) e as demais descartadas — pós-aprovação é indistinguível de
  orçamento de opção única.
- **`OrcamentoItem`** — `quantidade`, `larguraCm/alturaCm` (SEMPRE cm —
  `unidadeDimensao` é só a unidade de ENTRADA/EXIBIÇÃO, congelada na
  criação), `precoUnitario/precoTotal` (valor VENDIDO, travado),
  `precoSugeridoUnitario` (motor, paralelo), `descontoTipo`
  (`TipoDesconto`: PERCENTUAL/VALOR_ABSOLUTO/PRECO_FINAL) +
  `descontoValor`/`motivoDesconto`/`aprovadoPorId` (aprovação de desconto
  acima do teto), `modeloCalculo` (snapshot), campos por modelo
  (`corFrente/corVerso`, `numeroCoresFlexo`, `numeroCliques`,
  `numeroSetups`, `horasEstimadas`, `custoAquisicaoUnitario` p/ REVENDA),
  `materialFornecidoPeloCliente` (zera custo de substrato),
  `descricaoLivre` (sobrepõe nome no PDF), `breakdown` (Json, árvore de
  custo auditável).
- **`OrcamentoItemEtiqueta`** — spec técnica de rótulo/etiqueta (M2/
  flexografia), NUNCA entra no preço — 100% descritivo pra produção
  (material, adesivo, verniz, laminação, rebobinamento, serrilha). Tem
  filho `OrcamentoItemHotStamping` (1:N — pode ter mais de um hot/cold
  stamping por item).
- **`OrcamentoItemPrecificacaoEtiqueta`** — ao contrário do acima, ESTE
  entra no preço: snapshot do cálculo de clichê (`quantidadeCores`,
  `custoClicheCalculado`, `custoFaca`, `custoFrete`).
- **`OrcamentoItemAcabamento`** — acabamento estruturado aplicado
  (substitui texto livre quando `modeloCalculo != SIMPLES`): `qtdBase`
  (snapshot da base de cobrança), `custoCalculado`.
- **`OrcamentoItemTinta`** — estimativa de gasto de tinta por IA a partir
  de foto da arte (recurso pago). `coberturaPercentual` + CMYK,
  `consumoMlPorPeca/Total`, `confianca` (string, não enum — vem de LLM).
  Snapshot de quantidade/medida no momento da análise.

### Enums

- `StatusOrcamento`: RASCUNHO, ENVIADO, APROVADO, REJEITADO.
- `TipoPedidoOrcamento`: MODELO_NOVO, REPETICAO_SEM_ALTERACAO,
  REPETICAO_COM_ALTERACAO.
- `TipoFrete` (fechado, 6 valores oficiais NF-e `modFrete`):
  CIF_REMETENTE, FOB_DESTINATARIO, TERCEIROS, PROPRIO_REMETENTE,
  PROPRIO_DESTINATARIO, SEM_FRETE.
- `TipoDesconto`: PERCENTUAL, VALOR_ABSOLUTO, PRECO_FINAL.
- Etiqueta (M2/flexo, todos fechado+OUTRO exceto onde indicado):
  `MaterialSubstrato` (14 valores: PAPEL_TERMICO, COUCHE_C_ROT,
  BOPP_METALIZADO_ROT, BOPP_BCO_PEROLIZADO, BOPP_BCO_FOSCO,
  BOPP_TRANSPARENTE, L2_SEM_ADESIVO, POLIETILENO_BRANCO,
  POLIETILENO_TRANSPARENTE, POLIESTER_BRANCO, POLIESTER_TRANSPARENTE,
  POLIESTER_CROMO_FOSCO, ELETROSTATICO_SEM_COLA, OUTRO);
  `TipoAdesivo` (ACRILICO_20G, ACRILICO_30G, BORRACHA_20G/25G/30G/50G,
  OUTRO); `SuperficieAplicacao` (VIDRO, PLASTICO, METAL, PAPEL, PAPELAO,
  OUTROS); `TipoRotulagem` (MANUAL, AUTOMATICA — fechado, é um processo
  binário, não catálogo); `TipoSerrilha` (SERRILHA, MICRO_SERRILHA, GAP,
  OUTRO); `TipoLaminacao` (BRILHO, FOSCO, OUTRO); `TipoAcabamentoVerniz`
  (BRILHO, FOSCO, RIBBON, OUTRO); `TipoHotStamping` (HOT, COLD, OUTRO);
  `LadoEtiqueta` (ROTULO, CONTRA_ROTULO — fechado, só 2 lados físicos).

### Arquivos-chave

- `src/app/orcamento/actions.ts`, `[id]/actions.ts` — CRUD, cálculo, transição de status (`atualizarStatusOrcamento`), aprovação de desconto, vínculo cliente/contato/endereço, `gerarContasReceberDaAprovacao`. `[id]/opcoes.actions.ts` — `adicionarOpcaoOrcamento`, `resolverOpcoesNaAprovacao`.
- `src/lib/orcamento-precificacao.ts` — ponte `OrcamentoItem` ↔ `src/lib/pricing/*` (monta `ContextoPrecificacao`).
- `src/lib/orcamento-status.ts` — CAS, `orcamentoEstaExpirado`, `orcamentoEstaParado`.
- `src/lib/orcamento-opcoes.ts` (`MAX_OPCOES_ALTERNATIVAS = 2`), `orcamento-etapas.ts` (5 campos de etapa manual), `orcamento-etiqueta.ts` (validação `OrcamentoItemEtiqueta`), `orcamento-margem.ts` (margem/lucro exibido), `orcamento-duplicar.ts` ("Pedir de novo"), `orcamento-item-entrada.ts`.
- `src/lib/preflight.ts` — checagem de DPI/sangria no upload de arte.
- `src/lib/condicao-pagamento.ts` — `garantirCondicoesPagamentoPadrao`, `gerarContasReceberDaAprovacao`.
- `src/lib/credito-cliente.ts` — `calcularExposicaoCreditoCliente` (checado na aprovação contra `Cliente.limiteCredito`).
- `src/app/o/[token]/` — link público sem login (`page.tsx`, `actions.ts:responderOrcamentoPublico`, `pdf/`); `src/app/a/[token]/` — link público de resposta de ARTE (distinto do link de orçamento).
- `src/lib/pdf/OrcamentoDocumento.tsx`, `mapear-dados.ts`, `termos-padrao.ts` — geração de PDF.

---

## 4. Produção

### Models principais

- **`Pedido`** — nasce quando `Orcamento` é aprovado (1:1). `status`:
  `StatusPedido` (FSM linear de 8 estágios + CANCELADO).
  Campos-chave: `prazoEntrega` (data pura), `alertaAtrasoEnviadoEm`
  (dedup webhook), `alertaPrazoUltimoLimiarDias` (cascata 5→3→0, só
  avança), arte (`arteUrl`, `arteAprovadaEm`, `arteComentarioCliente`,
  `arteLinkToken`, `preflightAvisos`), `producaoLinkToken` (link público
  evergreen `/p/[token]`), `qrToken` (QR físico `/q/[token]`, gerado sob
  demanda, sem rate-limit nem checagem de etapa esperada — só circula
  dentro da gráfica), `aprovadoEm` (gatilho dos snapshots de custo),
  `precoSugeridoTotal/valorNegociadoTotal/custoPrevistoTotal` (snapshot),
  `fechadoEm/fechadoPorId` (fechamento explícito do P&L do pedido, ato
  manual em tela própria, nunca automático).
- **`ApontamentoEtapa`** — histórico de ENTRADA em cada etapa (achado B1/
  B2 da auditoria). Aberto/fechado na MESMA transação do CAS de
  `Pedido.status`. `origemConfirmacao`: `OrigemConfirmacaoEtapa`
  (APP/LINK_PUBLICO/QR_ETIQUETA). Até 5 FKs de máquina OPCIONAIS (0
  preenchidas é válido, diferente de `RegistroManutencao`), `onDelete:
  SetNull` (histórico sobrevive à exclusão da máquina). Sem
  `quantidadeBoa/quantidadeRefugo` ainda (fora de escopo).
- **`ResponsavelEstagio`** — atribuição gráfica-wide (não por pedido) de
  quem recebe e-mail/pode confirmar cada uma das 5 etapas "vivas"
  atribuíveis (PRODUCAO/ACABAMENTO/CONFERENCIA/EMBALAGEM/EXPEDICAO). ARTE
  e CLICHE_FACA ficam de fora (decisão de produto).
- **`Entrega`** — status ESTRUTURADO da entrega física (1:1 `Pedido`,
  só existe depois que a produção física começa). `status`:
  `StatusEntrega` (AGUARDANDO/EM_TRANSITO/ENTREGUE/PROBLEMA — PROBLEMA é
  lateral, nunca terminal). `motorista` texto livre (não cadastro
  relacional).
- **`CustoPedido`** — custo REAL lançado num pedido (manual ou
  automático). `origem`: `OrigemCusto` (MANUAL/CONSUMO_ESTOQUE/COMISSAO/
  SERVICO_INSUMO/GANG_RUN/COMPRA). `movimentacaoEstoqueId`/
  `solicitacaoCompraId` únicos (dedup). `valorCalculado` (antes de edição
  manual) vs `valor` (final), `editadoManualmente`, `possivelDuplicidade`,
  `estornadoEm` (cancelamento nunca deleta custo automático).
- **`PedidoCustoPrevisto`** — previsão de custo por CATEGORIA, congelada
  na aprovação (`origem`: `OrigemPrevisao` MOTOR_PRECIFICACAO/
  FICHA_TECNICA/MANUAL). Nunca recalculada.
- **`GrupoGangRun`** / **`FilaGangRun`** — combinação de chapa offset
  entre pedidos pequenos (`fracaoFolha < 1`) que compartilham
  papel+gramatura+prensa+folha+cores. `FilaGangRun` é 1:1 com
  `OrcamentoItem`, criado na aprovação (nunca recalculado). MVP não
  otimiza automaticamente quais combinar — operador escolhe manualmente
  em `/producao/gang-run`. `custoRateado` vira `CustoPedido` origem
  `GANG_RUN`.

### Enums

- `StatusPedido` (FSM, ordem canônica em `producao-estagios.ts`, NÃO na
  ordem de declaração do enum): ARTE, CLICHE_FACA, PRODUCAO, ACABAMENTO,
  CONFERENCIA, EMBALAGEM, EXPEDICAO, ENTREGUE, CANCELADO (terminal
  alcançável de qualquer estágio antes de ENTREGUE; estorna matéria-prima
  se já passou de CLICHE_FACA).
- `OrigemConfirmacaoEtapa`: APP, LINK_PUBLICO, QR_ETIQUETA.
- `StatusEntrega`: AGUARDANDO, EM_TRANSITO, ENTREGUE, PROBLEMA.
- `OrigemCusto`: MANUAL, CONSUMO_ESTOQUE, COMISSAO, SERVICO_INSUMO,
  GANG_RUN, COMPRA.
- `OrigemPrevisao`: MOTOR_PRECIFICACAO, FICHA_TECNICA, MANUAL.
- `StatusFilaGangRun`: AGUARDANDO, COMBINADO, CANCELADO.
- `AreaAdministrativa`: NOTA_FISCAL, PRAZO_PRODUCAO (enum aberto pra
  outras áreas futuras — ver `ResponsavelAdministrativo`).

### Arquivos-chave

- `src/app/producao/actions.ts` — `avancarPedido`, `cancelarPedido` (estorno de estoque).
- `src/app/producao/status-transicao.ts` — CAS de `StatusPedido`, gera/fecha `ApontamentoEtapa`, dispara custo automático ao entrar em PRODUCAO.
- `src/app/producao/entrega-actions.ts` / `entrega-transicao.ts` — CAS de `StatusEntrega`.
- `src/app/producao/[pedidoId]/fechamento/` — fechamento explícito do P&L do pedido (permissão `custosVerLucro`).
- `src/app/producao/[pedidoId]/ordem-producao/` — PDF (`src/lib/pdf/OrdemProducaoDocumento.tsx`, `mapear-dados-ordem-producao.ts`).
- `src/app/producao/[pedidoId]/etiqueta/` — gera/imprime o QR físico (`qrToken`).
- `src/app/producao/gang-run/` — tela de combinação manual; `src/lib/gang-run.ts` (puro: `ehCandidatoGangRun`, `chaveGrupoGangRun`) / `gang-run-servico.ts` (Prisma: `combinarGrupoGangRun`, `cancelarCandidatosDoPedido`, `registrarCandidatosGangRun`, `ratearCustoSetup`).
- `src/lib/producao-estagios.ts` — `SEQUENCIA_STATUS_PEDIDO`, `ESTAGIOS_ATRIBUIVEIS`, `ESTAGIOS_PRE_PRODUCAO`.
- `src/lib/custo-pedido.ts` — `criarCustoAutomaticoCompra`, `CATEGORIAS_CUSTO_SUGERIDAS`; `custo-producao.ts`, `perda-fixa-producao.ts`.
- `src/lib/apontamento-etapa.ts`, `alerta-prazo-email.ts` (cron, cascata de limiares), `alerta-atraso.ts` (webhook `pedido_atrasado`), `qr-code.ts`.
- `src/app/p/[token]/` (confirmação pública de etapa, `ConfirmarEstagioPublico.tsx`) e `src/app/q/[token]/` (via QR físico, `AvancarStatusQr.tsx`).
- `src/lib/pedido-aprovacao.ts` — cria o `Pedido` na aprovação (snapshots, `FilaGangRun`, `ContaReceber`).

---

## 5. Financeiro

### Models principais

- **`Pagamento`** — dinheiro ENTRANDO (de um `Orcamento` aprovado).
  `forma`: `FormaPagamento`. Saldo devedor = `total - soma(Pagamento)`,
  nunca armazenado.
- **`Despesa`** — dinheiro SAINDO. `status`: `StatusDespesa`
  (PENDENTE/PARCIAL/PAGA). `categoria` (texto) + `categoriaCustoId`
  (par estruturado opcional). `vencimento` é DATA PURA (meia-noite UTC,
  padrão a seguir por qualquer data-pura futura — ver `src/lib/data.ts`).
  Recorrência: `recorrente`, `serieRecorrenciaId` (1ª ocorrência = próprio
  id), `periodicidade` (`PeriodicidadeDespesa`), `recorrenciaAteEm`,
  `valorVariavel` (série nasce com valor 0 em vez de copiar). `status`/
  `pagoEm` NUNCA editados por form genérico — só por
  `marcarComoPaga`/`marcarComoPendente`.
- **`PagamentoDespesa`** — baixa (total ou parcial) de UMA `Despesa`
  (1:N simples).
- **`ContaReceber`** — parcela esperada de um `Orcamento` aprovado
  (contraparte de `Despesa`). `status`: `StatusContaReceber`
  (PENDENTE/PARCIAL/RECEBIDO/CANCELADO). Gerada automaticamente na
  aprovação quando o orçamento tem `CondicaoPagamento` vinculada (snapshot,
  só âncora `APROVACAO` tem gatilho plumbado — `EMISSAO_NOTA`/`ENTREGA`
  existem no enum mas sem trigger ainda). `clienteId` denormalizado
  (índice direto pro relatório "quanto o cliente X deve").
- **`BaixaContaReceber`** — N:N entre `ContaReceber` e `Pagamento` com
  valor (uma parcela pode levar mais de um pagamento pra fechar). Caminho
  NOVO — pagamento em valor EXATO continua fechando via
  `ContaReceber.pagamentoId` direto, sem linha aqui.
- **`CondicaoPagamento`** + **`CondicaoPagamentoParcela`** — "jeito de
  cobrar" reutilizável (nome, `ancora`: `AncoraVencimento`,
  `acrescimoPercent`). Parcelas: `ordem`, `percentual`, `diasAposAncora`
  (soma de percentual deveria ser 100, validado em app).
- **`Comissao`** — SNAPSHOT de comissão de vendedor (taxa + política de
  cálculo no momento da aprovação). `baseCalculo`: `BaseComissao`.
  1 por orçamento (`@unique`). Vira `Despesa` quando marcada paga.
- **`ContaPrepaga`** + **`MovimentacaoContaPrepaga`** — carteira PREPAGA
  da PRÓPRIA gráfica junto a um fornecedor (ex: Lalamove).
  `saldoAtual` É cache (atualizado na mesma transação). `tipo`:
  `TipoMovimentacaoContaPrepaga` (RECARGA/DEBITO). RECARGA gera `Despesa`.
- **`CreditoCliente`** + **`MovimentacaoCreditoCliente`** — saldo
  adiantado que um CLIENTE tem com a gráfica (sentido oposto de
  `ContaPrepaga`). Saldo SEMPRE calculado (nunca armazenado — ver padrão
  #1). `tipo`: `TipoMovimentacaoCreditoCliente` (DEPOSITO/CONSUMO/ESTORNO/
  AJUSTE — só AJUSTE aceita valor negativo).
- **`CategoriaCusto`** — categoria configurável por gráfica (nunca enum
  fixo), compartilhada entre `CustoPedido`, `PedidoCustoPrevisto`,
  `ItemGrafica.categoriaCustoId`, `Despesa.categoriaCustoId`.
- **`LogAuditoria`** — trilha "quem mudou o quê" (`usuarioNome` e
  `entidadeId` são snapshots em texto, NÃO FK — sobrevivem à remoção do
  usuário ou hard-delete da entidade).

### Enums

- `FormaPagamento` (fechado + OUTRO): DINHEIRO, PIX, CARTAO, BOLETO,
  TRANSFERENCIA, OUTRO.
- `StatusDespesa`: PENDENTE, PARCIAL, PAGA.
- `PeriodicidadeDespesa`: SEMANAL, QUINZENAL, MENSAL, BIMESTRAL,
  TRIMESTRAL, SEMESTRAL, ANUAL.
- `StatusContaReceber`: PENDENTE, PARCIAL, RECEBIDO, CANCELADO.
- `AncoraVencimento`: APROVACAO, EMISSAO_NOTA, ENTREGA, OUTRO (só
  APROVACAO com gatilho automático implementado).
- `StatusComissao`: PENDENTE, PAGA.
- `BaseComissao`: VALOR (% sobre total), LUCRO (% sobre total - custo).
- `TipoMovimentacaoContaPrepaga`: RECARGA, DEBITO.
- `TipoMovimentacaoCreditoCliente`: DEPOSITO, CONSUMO, ESTORNO, AJUSTE.

### Arquivos-chave

- `src/app/financeiro/actions.ts` — CRUD `Despesa`, `marcarComoPaga`.
- `src/app/financeiro/contas-receber/actions.ts` — `registrarBaixaContaReceber`, `marcarComoRecebido`, `cancelarContaReceber`.
- `src/app/financeiro/comissoes/actions.ts` — `marcarComissaoPaga`; `contas-prepagas/actions.ts` — `lancarMovimentacaoContaPrepaga`.
- `src/app/financeiro/creditos-clientes/`, `auditoria/` (tela do `LogAuditoria`), `exportar/route.ts` (lê `Pagamento` + `ContaReceber`/`BaixaContaReceber`).
- `src/lib/baixa-financeira.ts` — `saldoContaReceber`/`saldoDespesa` (sempre recalculados).
- `src/lib/credito-cliente.ts` — `saldoCreditoCliente`, `lançarConsumoCreditoCliente`, `calcularExposicaoCreditoCliente`.
- `src/lib/comissao.ts` (cálculo puro), `despesa-recorrente.ts` (`gerarDespesasRecorrentesPendentes`), `condicao-pagamento.ts` (gera `ContaReceber`).
- `src/lib/relatorios-negocio.ts`, `meu-negocio.ts` — dashboard "Meu Negócio" (lucro/faturamento/custos por categoria, filtrável por período/cliente).
- `src/lib/auditoria.ts` — `registrarAuditoria`.

---

## 6. Compras

### Models principais

- **`Fornecedor`** — cadastro simples (nome, contato texto livre, ativo).
  Sem workflow de cotação/aprovação embutido nele mesmo — isso é
  `SolicitacaoCompra`/`CotacaoFornecedor`.
- **`SolicitacaoCompra`** — o PEDIDO DE COMPRA em si, workflow completo:
  `status` (`StatusSolicitacaoCompra`). Campos-chave: `itemGraficaId` +
  `varianteId` opcional, `fornecedorId` opcional (só costuma preencher a
  partir de APROVADO), `quantidade` (sempre unidade de ESTOQUE — fonte
  única lida pelo resto do sistema), campos de unidade de COMPRA
  (`unidadeCompra`, `quantidadeCompra`, `fatorConversaoCompra`,
  `precoUnitarioCompra` — só informativos/reconstrução, nunca usados em
  cálculo de custo), `valorEstimado` vs `valorFinal` (o FINAL é o que
  vira custo snapshotado), `origem` (`OrigemSolicitacaoCompra`) +
  `pedidoId` (obrigatório em app só quando origem=PEDIDO_ESPECIFICO),
  `contratoFornecimentoId` (quando origem=CONTRATO_PROGRAMADO, nasce
  direto em APROVADO), datas de cada transição
  (`solicitadoEm`...`canceladoEm`).
- **`CotacaoFornecedor`** — "mapa de cotação": UMA cotação de UM
  fornecedor pra UMA solicitação (`@@unique([solicitacaoCompraId,
  fornecedorId])` — recotar faz upsert). `precoUnitario`, `valorTotal`,
  `prazoEntregaDias`, `condicaoPagamento` (texto livre — NÃO reaproveita
  `FormaPagamento`, que é sobre MEIO de pagamento de venda, conceito
  diferente), `vencedora` (Boolean, só uma por solicitação, garantido em
  código não em constraint). DIFERENTE de `comparativo-fornecedores.ts`
  (que é histórico RETROSPECTIVO derivado de compras já recebidas) — este
  model é cotação ATIVA, antes de qualquer compra acontecer.
- **`ContratoFornecimento`** — preço fixo por período/fornecedor (dá
  função real a `OrigemSolicitacaoCompra.CONTRATO_PROGRAMADO`).
  `itemGraficaId`/`varianteId` OPCIONAIS (null = "coringa" pra qualquer
  item/variante desse fornecedor). `precoUnitario` sempre em unidade de
  ESTOQUE (`unidadeCompra` aqui é só rótulo informativo, SEM fator de
  conversão próprio — gap conhecido). `vigenciaInicio/Fim`,
  `quantidadeContratada` (teto opcional) vs `quantidadeConsumida` (só
  cresce via `increment()` na MESMA transação do RECEBIDO).
- **`MovimentacaoEstoque`** (ver domínio Catálogo) — `ENTRADA_COMPRA`
  gerada ao confirmar RECEBIDO, `solicitacaoCompraId` único (1:1 dedup).

### Enums

- `StatusSolicitacaoCompra` (FSM): SOLICITADO, COTANDO, APROVADO,
  COMPRADO, RECEBIDO, CONFERIDO, CANCELADO (alcançável de qualquer estado
  antes de RECEBIDO).
- `OrigemSolicitacaoCompra` (fechado + OUTRO): REPOSICAO_ESTOQUE (default,
  make-to-stock), PEDIDO_ESPECIFICO (make-to-order, vira `CustoPedido`
  origem COMPRA), MANUTENCAO, CONSUMO_INTERNO, CONTRATO_PROGRAMADO, OUTRO.
- `UnidadeCompra` — ver domínio Catálogo (compartilhado).

### Arquivos-chave

- `src/app/compras/actions.ts` — `criarSolicitacaoCompra` (resolve contrato aplicável, copia preço/fornecedor).
- `src/app/compras/status-transicao.ts` — `avancarStatusCompra` (CAS), gera `MovimentacaoEstoque` + `CustoPedido` em RECEBIDO.
- `src/app/compras/nova/NovaSolicitacaoForm.tsx` — form (Client Component, usa split `-db.ts`); `contratos/` — CRUD de `ContratoFornecimento`.
- `src/lib/compras-status.ts` — `TRANSICOES_VALIDAS`.
- `src/lib/contrato-fornecimento.ts`/`-db.ts` — `contratosAplicaveis`, `listarContratosProximosDoLimite`.
- `src/lib/cotacao-fornecedor.ts`/`-db.ts` — `definirCotacaoVencedora`.
- `src/lib/comparativo-fornecedores.ts`/`-db.ts` — histórico retrospectivo de preço por fornecedor (`chaveComparativo`, `montarComparativoFornecedores`).
- `src/lib/previsao-estoque.ts`/`-db.ts` — previsão de ponto de encomenda (`JANELA_DIAS`, `calcularPrevisaoItem`).
- `src/lib/gang-run-servico.ts` — rateio de chapa (ver Produção).

---

## 7. Clientes / Fiscal

### Models principais

- **`Cliente`** — cadastro central. Soft-delete (`desativadoEm`).
  Comercial: `bloqueadoParaVenda`/`motivoBloqueio` (decisão MANUAL, aviso
  não-bloqueante), `bloqueadoParaFaturamento`/`motivoBloqueioFaturamento`
  (mesmo formato, causa distinta — trava NOVAS vendas a prazo),
  `limiteCredito` (estouro AUTOMÁTICO detectado por
  `calcularExposicaoCreditoCliente`, distinto de `bloqueadoParaVenda`),
  `prazoPagamentoPadraoDias`, `formaPagamentoPreferida`
  (`FormaPagamento?`, sem `Outro` — só sugestão de preenchimento),
  `descontoPadraoPercent`, `observacaoFinanceira` vs `observacoes`
  (financeiro vs comercial genérico) vs `preferenciasProducao` (aparece
  na Ordem de Produção impressa). `origem`/`origemOutro`
  (`OrigemCliente`), `segmento`/`segmentoOutro` (`SegmentoCliente`),
  `margemPadraoOverride` (sobrescreve `ParametrosGrafica.margemPadrao` só
  pra este cliente), `vendedorId` (distinto de `Orcamento.usuarioId`, só
  afeta `Comissao` quando `comissaoSegueVendedorDoCliente=true`).
  Fiscal: `tipoPessoa` (`TipoPessoa?`), `razaoSocial`/`nomeFantasia`
  (preferidos sobre `nome` na emissão), `inscricaoEstadual` +
  `indicadorInscricaoEstadual` (`IndicadorInscricaoEstadual`),
  `inscricaoMunicipal` (reservado, sistema só emite NF-e hoje), endereço
  fiscal inline (`enderecoCep`...`enderecoUf` + `enderecoCodigoIbge`).
- **`ContatoCliente`** — contato individual de cliente PJ (não substitui
  `Cliente.email/telefone`). `funcao`: `FuncaoContatoCliente`.
  `principal` (só 1 por cliente, imposto em app). Soft-delete (`ativo`).
- **`EnderecoCliente`** — endereço adicional (cobrança/entrega distintos
  do fiscal). `tipo`: `TipoEnderecoCliente`. `padrao` (1 por TIPO por
  cliente, imposto em app via `$transaction`). `instrucoesEntrega`.
  Fora de escopo: grupos econômicos/matriz-filial entre clientes
  diferentes (só cobre múltiplos endereços do MESMO cadastro).
- **`DadosFiscaisGrafica`** — dados do emitente (CNPJ, razão social,
  endereço) + token Focus NFe PRÓPRIO da gráfica (bring-your-own-account).
  `regimeTributario` (`RegimeTributario`) decide CSOSN (Simples) vs
  CST+ICMS (Normal). `cfopPadrao`/`cfopPadraoInterestadual` (resolvido por
  UF do cliente vs UF da gráfica — não distingue contribuinte/não-
  contribuinte ainda, gap conhecido).
- **`DadosFiscaisFilial`** — espelha `DadosFiscaisGrafica` campo a campo
  pra filial com CNPJ PRÓPRIO (tabela separada, não FK nullable —
  problema de unicidade parcial com NULL no Postgres). Sem caso real
  ainda, construído preventivamente.
- **`NotaFiscal`** — 1:1 com `Orcamento`. `status`:
  `StatusNotaFiscal`. `referencia` (idempotência do lado da Focus NFe).
- **`Filial`** — COMPARTILHA catálogo/estoque/financeiro com a gráfica
  inteira (não é tenant separado) — só rótulo de "onde foi feito" pra
  relatório.

### Enums

- `OrigemCliente` (fechado + OUTRO): INDICACAO, REDES_SOCIAIS,
  BUSCA_GOOGLE, ANUNCIO, FEIRA_EVENTO, PROSPECCAO_ATIVA, CLIENTE_ANTIGO,
  OUTRO.
- `SegmentoCliente` (fechado + OUTRO): VAREJO, EMPRESA, REVENDA_AGENCIA,
  INDUSTRIA, ORGAO_PUBLICO, OUTRO.
- `TipoPessoa` (fechado, sem OUTRO — só existem 2 no direito brasileiro):
  FISICA, JURIDICA.
- `IndicadorInscricaoEstadual` (fechado, tag fixa NF-e): CONTRIBUINTE,
  ISENTO, NAO_CONTRIBUINTE.
- `FuncaoContatoCliente` (fechado + OUTRO): COMPRADOR, FINANCEIRO,
  APROVACAO_ARTE, RECEBIMENTO, OUTRO.
- `TipoEnderecoCliente` (fechado, 3 papéis fixos): PRINCIPAL, COBRANCA,
  ENTREGA.
- `RegimeTributario` (fechado, só 3 regimes reais): SIMPLES_NACIONAL,
  LUCRO_PRESUMIDO, LUCRO_REAL.
- `StatusNotaFiscal`: PROCESSANDO, AUTORIZADA, REJEITADA, CANCELADA, ERRO.

### Arquivos-chave

- `src/app/clientes/actions.ts` — CRUD, `anonimizarCliente` (LGPD, sobrescreve PII além de desativar).
- `src/lib/clientes.ts` (helpers puros), `contatos-cliente.ts`/`enderecos-cliente.ts` (regra de `principal`/`padrao` único), `historico-cliente.ts` (ficha do cliente).
- `src/lib/nota-fiscal.ts` — `resolverDadosFiscais` (grafica vs filial), `resolverCfop`, `resolverModalidadeFrete`, `verificarProntidaoFiscal`; `nota-fiscal-tabelas.ts` (códigos CST/CSOSN).
- `src/lib/focus-nfe.ts` — integração com a API da Focus NFe (payload de emissão, mapeamento de indicador IE pros códigos 1/2/9).
- `src/lib/telefone.ts` — validação/formatação de telefone BR.

---

## 8. Configurações

### Models principais (resumo telegráfico — domínio de menor prioridade)

- **`Grafica`** — tenant raiz: identidade visual (`logoUrl`, `corPrimaria`, contato pro PDF), `unidadePadraoDimensao` (`UnidadeDimensao` MM/CM/M — só entrada/exibição, banco sempre grava cm), `segmento`/`segmentoOutro` (`SegmentoGrafica`, descritivo, semeia defaults, nunca restringe), `compartilharMeuNegocio`.
- **`ParametrosGrafica`** — 1:1, painel de controle do motor de preço e políticas: composição de preço (`overheadPercent`, `margemPadrao`, `impostoPercent`, `comissaoPercent`, `taxaFinanceiraPercent`, `pedidoMinimo`, `incrementoArredondamento`), nesting (`margemSegurancaPadrao`, `gapPecasPadrao`), comissão (`comissaoVendedorBase`: `BaseComissao`, `comissaoSegueVendedorDoCliente`), custo-real (`custoAutomaticoConsumo`, `categoriaCustoConsumoPadraoId`, `comissaoEntraNoCustoPedido`, `perdaEhCustoDoPedido`, faixas de margem, `descontoMaxSemAprovacao`, `diasPrecoInsumoDesatualizado`), crédito (`bloqueiaAoUltrapassarLimiteCredito`), validade/tolerância de orçamento (`diasValidadeOrcamentoPadrao`, `toleranciaTiragemPadraoPercent`, `toleranciaTiragemPercent`), alerta de prazo (`alertaPrazoAtivo` + 3 limiares, `diasAlertaOrcamentoParado`), `termosCondicoesPdf`, `mostrarEspecificacoesTecnicas` (some só da view do cliente), dias úteis (`prazoEmDiasUteis`, `diasFuncionamento` bitmask).
- **`FeriadoGrafica`** — feriado por gráfica (cidade/UF próprias), `recorrenteAnual` (compara só mês/dia).
- **`AutomacaoGrafica`** — webhook n8n PRÓPRIO da gráfica, 3 toggles de evento.
- **`AssinaturaGrafica`** — billing da plataforma sobre a gráfica (ver domínio 9).
- **`Usuario`**/**`PermissaoUsuario`** — `papel` (`PapelUsuario`), controle granular só pra OPERADOR (`ModuloPermissao`), `comissaoPercent` pessoal, `desativadoEm`, `superAdmin` (cross-tenant, bootstrap manual).

### Enums

- `UnidadeDimensao`: MM, CM, M.
- `SegmentoGrafica` (fechado + OUTRO): ROTULOS_ETIQUETAS, OFFSET_COMERCIAL, COMUNICACAO_VISUAL, ESTAMPARIA_VESTUARIO, BRINDES_PERSONALIZADOS, EMBALAGEM_CARTONAGEM, EDITORIAL_LIVRO, CORTE_LASER_ACRILICO, GRAFICA_RAPIDA, OUTRO.
- `PapelUsuario`: DONO, ADMIN, OPERADOR.
- `ModuloPermissao`: ORCAMENTO, CLIENTES, CATALOGO, PRODUCAO, FINANCEIRO, CONFIGURACOES, CUSTOS, COMPRAS.

### Arquivos-chave

- `src/app/configuracoes/actions.ts` — `salvarParametros`; subpastas `{prensas,maquinas,fornecedores,filiais,categorias-custo,feriados,identidade,fiscal,automacao,assinatura}/` — uma por sub-tela.
- `src/lib/dias-uteis.ts` (`somarDiasUteis`), `modulos-permissao.ts`/`auth/permissoes.ts` (`podeVerModulo`/`podeEditarModulo`/`podeConfirmarEstagio`), `papel-usuario.ts`.
- `src/lib/onboarding.ts` (`/comecar`, `/bem-vindo`), `dados-exemplo.ts` (pacote calibrado por `segmento`), `pendencias-configuracao.ts` (checklist de config pendente).

---

## 9. Auth / Billing / Infra transversal

Não é um dos 7 domínios de negócio, mas sustenta todos — útil saber onde fica:

- **Auth:** `src/lib/auth/session.ts` (`exigirUsuarioAutenticado`, cookie opaco + `Sessao.tokenHash`), `permissoes.ts`, `rate-limit.ts`, `password.ts` (argon2id), `token-reset.ts`, `verificacao-email.ts`, `superadmin.ts`, `assinatura.ts` (gate de acesso). Models: `Usuario`, `Sessao`, `TokenResetSenha`, `TokenVerificacaoEmail`, `TentativaLogin`, `TentativaRegistro`, `TentativaResetSenha`, `TentativaVerificacaoEmail`, `TentativaRespostaArte`, `TentativaConfirmacaoEstagio`, `TentativaRespostaOrcamento` (uma tabela de rate-limit POR fluxo público, nunca compartilhada).
- **Billing** (SaaS da plataforma sobre a gráfica, conta Stripe nossa): `src/lib/billing/*` — `planos.ts`, `precos.ts`, `status.ts` (carência de 2 meses de inadimplência), `limite-uso.ts` (teto de orçamentos/mês, tolerância 15 dias), `limite-armazenamento.ts`, `limite-importacao.ts`, `recursos-pagos.ts` (feature gate, ex: tinta IA), `checkout-reserva.ts` (CAS via `checkoutIniciadoEm`), `sincronizar.ts` (webhook Stripe → `AssinaturaGrafica`). Models: `AssinaturaGrafica`, `ArquivoArmazenado` (razão de storage por cota).
- **Importação de planilha com IA:** `src/lib/importacao/*` (`escritor-catalogo.ts`, `escritor-clientes.ts`, `escritor-pedidos.ts`). Model `ImportacaoPlanilha` (também conta cota mensal).
- **PDF:** `src/lib/pdf/*` — `OrcamentoDocumento.tsx`, `OrdemProducaoDocumento.tsx`, `EtiquetaPedidoDocumento.tsx`.
- **E-mail:** `src/lib/email/*` — `templates.ts`, `webhook-email.ts` (webhook n8n compartilhado entre TODOS os tenants, cota única do Gmail/Workspace — motivo dos rate-limits granulares acima).
- **Webhooks de saída:** `webhook-automacao.ts` (eventos pra n8n da própria gráfica), `webhook-tinta.ts`, `webhook-assistente.ts`, `webhook-importacao.ts`, `webhook-envelope.ts`, `webhook-metricas.ts`.
- **Cron:** `src/app/api/cron/` via `src/lib/lifecycle-cron.ts` (expira reservas abandonadas, e-mail de trial acabando, alerta de prazo diário).
- **CSV/export:** `src/lib/csv.ts`.
- **Assistente de IA:** `PerguntaAssistenteLog` (rate-limit, não guarda conteúdo) — webhook próprio da plataforma (`ASSISTENTE_WEBHOOK_URL`), distinto do webhook de automação por tenant.

---

## Notas finais pra quem for pesquisar em cima disto

- O schema tem ~100 models e ~50 enums — este mapa cobre os
  relevantes pra abrangência de produto, omitindo tabelas puramente
  técnicas (rate-limit, sessão, tokens) do detalhamento por domínio (elas
  aparecem só na seção 9).
- Migrations pendentes não commitadas na sessão de 2026-08-30 (ver
  `git status` do repo): `20260829120000_apontamento_etapa`,
  `20260829120000_configuracao_emenda` — já refletidas nos models
  `ApontamentoEtapa` e `ConfiguracaoEmenda` acima.
- Pra achar rapidamente onde uma regra de negócio vive: os arquivos em
  `src/lib/*.ts` (sem sufixo `-db`) tendem a ser lógica PURA e testável
  (têm `.test.ts` irmão quase sempre); a Server Action em
  `src/app/<modulo>/actions.ts` é a casca fina que autentica, chama a
  lógica pura, e persiste.
- `pesquisa-abrangencia-modulos.md` (raiz do repo) é o documento de
  achados/gaps — 112 achados catalogados até 2026-08-30 (Partes 1-7),
  organizado pelos mesmos 7 domínios deste mapa. Leia ESTE arquivo
  (`arquitetura-resumo.md`) primeiro pra entender "o que existe", depois
  `pesquisa-abrangencia-modulos.md` pra "o que falta e já foi
  identificado" — evita redescobrir gap já catalogado.
