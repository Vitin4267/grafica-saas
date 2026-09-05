import type { OrigemPrecoPapel } from "./papel";

export type ModeloCalculo =
  | "SIMPLES"
  | "M2"
  | "OFFSET"
  | "FLEXOGRAFIA"
  | "DIGITAL"
  | "SERIGRAFIA"
  | "SUBLIMACAO"
  | "ESTAMPAGEM_QUENTE"
  | "PERSONALIZACAO"
  | "REVENDA"
  | "BORDADO"
  | "TEMPO_MAQUINA"
  | "DTF";
export type BaseCobranca =
  | "UNIDADE"
  | "M2"
  | "FOLHA_IMPRESSA"
  | "METRO_LINEAR"
  | "FIXO"
  | "HORA"
  | "MILHEIRO"
  | "CENTO";
export type EstagioAcabamento = "PRE_REFILE" | "POS_REFILE";

// ---------- Cenário 1 (m² / bobina) ----------

export type Bobina = {
  id: string;
  larguraNominal: number; // W_nominal, metros
  refile: number; // m_refile por lado, metros
};

export type PedidoM2 = {
  larguraM: number; // w
  alturaM: number; // h
  quantidade: number; // Q
  margemSeguranca?: number; // s — usa o default do tenant se omitido
  gapPecas?: number; // g — usa o default do tenant se omitido
};

export type ContextoM2 = {
  bobinas: Bobina[];
  custoM2Material: number; // ItemGrafica.precoCompra do material em bobina
  custoImpressaoM2: number; // ItemGrafica.custoImpressaoM2 do produto
  // ItemGrafica.areaMinimaFaturavel do produto (m²) — achado N18: piso
  // comercial por PEÇA (não por pedido, ver pedidoMinimo em
  // ParametrosTenant). Peça menor que este valor é cobrada como se tivesse
  // esta área (ver custoImpressao em m2.ts). 0 = sem piso configurado
  // (comportamento de sempre, nenhuma regressão).
  areaMinimaFaturavel: number;
  // Achado A9 da auditoria de abrangência — config OPCIONAL do item
  // (ConfiguracaoEmenda). Ausente = comportamento de hoje inalterado
  // (calcularM2 lança PECA_EXCEDE_BOBINA quando a peça não cabe em nenhuma
  // bobina). Presente = peça maior que toda bobina cadastrada vira painéis
  // emendados em vez de erro (ver calcularM2 em m2.ts).
  configuracaoEmenda?: { custoPorMetroLinear: number; sobreposicaoM: number };
  // Achado A5 — só preenchidos (>0) quando o produto é DTF
  // (ItemGrafica.custoSubstratoPorPeca/custoPrensagemPorPeca); ausentes ou 0
  // pra M2 puro (nenhum produto M2 existente tinha esses campos, ver
  // migration). custoSubstratoPorPeca = camiseta/substrato que recebe o
  // transfer; custoPrensagemPorPeca = a prensa térmica — os dois somados
  // (× Q) ao custoBase do calcularM2 compartilhado, mesmo padrão de
  // ContextoDigital/ContextoSetupPorPeca.custoSubstratoPorPeca (Q × valor
  // por peça).
  custoSubstratoPorPeca?: number;
  custoPrensagemPorPeca?: number;
};

// ---------- Cenário 2 (offset / folha) ----------

export type FormatoFolhaInput = {
  id: string;
  nome: string;
  larguraFolha: number; // L_f, metros
  alturaFolha: number; // A_f, metros
};

export type PedidoOffset = {
  larguraM: number; // w
  alturaM: number; // h
  quantidade: number; // Q
  corFrente: number; // F
  corVerso: number; // V
  perdaPercent?: number; // p_perda — usa o default do tenant se omitido
  sangria?: number; // por lado, default 0.002-0.005 (spec §2.2)
  pinca?: number; // margem de pinça da impressora, default 0.012
  margemLateral?: number; // m_lat, refile/margens laterais da folha, default 0.01
  gapPecas?: number; // g, gap entre peças na folha, default 0.002
};

export type ContextoOffset = {
  folhas: FormatoFolhaInput[];
  gramaturaGm2: number;
  precoPorKg: number;
  viraFolha: boolean;
  // Achado N12 — devolvidos por resolverPrecoPapel (src/lib/pricing/papel.ts)
  // e antes descartados pelo chamador (carregarContextoPrecificacao). Só
  // repassados adiante (ResultadoOffset -> metricas -> breakdown) pra UI
  // avisar quando o R$/kg usado veio de uma gramatura diferente da
  // realmente escolhida no item (fallback pela mais próxima cadastrada).
  // Opcionais só pra não quebrar fixtures de teste que montam este contexto
  // à mão sem chamar resolverPrecoPapel (validar.test.ts, golden.test.ts) —
  // carregarContextoPrecificacao (caminho real) sempre preenche os dois.
  // Ausente = tratado como "EXATO" (sem aviso), mesmo default do resultado
  // de resolverPrecoPapel quando a gramatura bate exatamente.
  gramaturaBasePapel?: number;
  origemPrecoPapel?: OrigemPrecoPapel;
  // Faixa aceita pelo validador (achado N13) — vem de
  // ParametrosTenant.gramaturaMinGm2/gramaturaMaxGm2. Opcional aqui só pra
  // não quebrar fixture de teste antiga; validarPedidoOffset cai pro default
  // 30/500 (mesmo comportamento de sempre) quando omitido.
  gramaturaMinGm2?: number;
  gramaturaMaxGm2?: number;
  // Achado N8 — puro passthrough (mesmo espírito de gramaturaBasePapel/
  // origemPrecoPapel acima): quando o papel/gramatura deste item foram
  // ESCOLHIDOS NO ORÇAMENTO (override, ver OrcamentoItemPrecificacaoOffset),
  // carregarContextoPrecificacao ecoa aqui o que realmente usou, pra
  // orcamento-precificacao.ts saber o que gravar no snapshot — não é lido
  // pelo cálculo em si (calcularOffset já recebe gramaturaGm2/precoPorKg
  // resolvidos acima). undefined = não houve override, usou os valores fixos
  // do PRODUTO (comportamento de sempre, zero regressão).
  papelIdOverride?: string;
  gramaturaGm2Override?: number;
};

// ---------- Cenário 3 (acabamento) ----------

export type ConfigAcabamento = {
  itemGraficaId: string;
  nome: string;
  baseCobranca: BaseCobranca;
  estagio: EstagioAcabamento; // descritivo — não lido por acabamento.ts (achado N14)
  custoUnitario: number; // = ItemGrafica.precoCompra do serviço
  custoSetup: number;
  custoMinimo: number;
  custoFerramental?: number | null;
};

export type ContextoAcabamento = {
  quantidade: number;
  larguraEfetivaM: number; // w'
  alturaEfetivaM: number; // h'
  folhasBoas?: number;
  folhasPerda?: number;
  perimetroOuEmenda?: number;
  horasEstimadas?: number;
};

// ---------- Parâmetros do tenant ----------

export type ParametrosTenant = {
  overheadPercent: number;
  margemPadrao: number;
  impostoPercent: number;
  comissaoPercent: number;
  taxaFinanceiraPercent: number;
  // Achado N3 — piso de PEDIDO (todo o orçamento), não de item. Presente
  // aqui por completude (ParametrosGrafica inteiro), mas comporPreco NÃO lê
  // mais este campo — o piso é aplicado uma vez sobre a soma dos itens via
  // aplicarPisoDoPedido (compor.ts), nunca por item. Ver
  // recalcularTotalOrcamento em src/lib/orcamento-precificacao.ts.
  pedidoMinimo: number;
  incrementoArredondamento: number;

  margemSegurancaPadrao: number;
  gapPecasPadrao: number;

  // Achado N13 — faixa de gramatura aceita pelo validador do offset (ver
  // ContextoOffset acima e validarPedidoOffset em validar.ts). Opcional
  // igual aos outros dois campos acima: carregarParametrosTenant sempre
  // popula com o valor real (default 30/500 no schema), fixtures de teste
  // antigas que não passam esses campos continuam válidas.
  gramaturaMinGm2?: number;
  gramaturaMaxGm2?: number;
};

// ---------- Parâmetros da prensa (custo de máquina, só OFFSET) ----------

export type ParametrosPrensa = {
  custoHoraMaq: number;
  torres: number;
  custoChapa: number;
  folhasAcerto: number;
  tempoAcertoH: number;
  custoMilheiroRod: number;
  rodagemMinima: number;
  perdaPercentPadrao: number;
};

// ---------- Cenário 4 (flexografia / bobina, nesting 1D) ----------

export type PedidoFlexografia = {
  larguraM: number; // w
  alturaM: number; // h — comparado contra o passo do cilindro, não nesteado
  quantidade: number; // Q
  numeroCores: number;
  perdaPercent?: number; // p_perda — usa o default da máquina se omitido
  margemSeguranca?: number; // s — usa o default do tenant se omitido
  gapPecas?: number; // g — usa o default do tenant se omitido
};

export type ContextoFlexografia = {
  bobinas: Bobina[];
  custoM2Material: number; // ItemGrafica.precoCompra do material em bobina
};

// ---------- Parâmetros da máquina flexo (custo de máquina, só FLEXOGRAFIA) ----------

export type ParametrosMaquinaFlexo = {
  custoHoraMaq: number;
  numeroEstacoesCores: number;
  larguraMaquinaM: number;
  passoCilindroM: number;
  tempoAcertoH: number;
  metrosAcerto: number;
  custoMetroLinearRod: number;
  rodagemMinima: number;
  perdaPercentPadrao: number;
};

// ---------- Cenário 5 (digital, imposição em folha — achado N4) ----------

// Achado N4 da auditoria de código (2026-09-04): o motor Digital passou a
// fazer IMPOSIÇÃO igual ao Offset — antes cobrava clique e substrato POR
// PEÇA (Q × numeroCliques × custoPorClique, Q × custoSubstratoPorPeca), o
// que superfaturava em até Nx quando N peças cabiam numa mesma folha (ex:
// 1000 cartões de visita 24-up custavam como 1000 cliques/folhas, quando o
// real é ~42). larguraM/alturaM viram OBRIGATÓRIOS (antes eram opcionais,
// só pra alimentar um acabamento M2 anexado) — sem eles não dá pra calcular
// nUp. numeroCliques deixa de ser "cliques por peça" e vira um OVERRIDE
// opcional de "cliques por FOLHA" (default 1) — só preencha pra forçar outro
// valor, ex: frente-e-verso que exige 2 passadas na mesma folha.
export type PedidoDigital = {
  larguraM: number; // w
  alturaM: number; // h
  quantidade: number; // Q
  numeroCliques?: number; // override opcional de cliques POR FOLHA — default 1 se omitido (ver comentário acima)
  sangria?: number; // por lado, default 0.002-0.005 (spec §2.2, mesmo default do Offset)
  margemLateral?: number; // m_lat, refile/margens laterais da folha, default 0.01
  gapPecas?: number; // g, gap entre peças na folha, default 0.002
};

export type ContextoDigital = {
  // Formatos de folha do PAPEL (matéria-prima) escolhido NESTE ORÇAMENTO —
  // diferente do Offset (onde o papel é fixo no PRODUTO, configurado uma vez
  // em Catálogo), o papel do Digital é escolhido por orçamento, mesmo padrão
  // de OrcamentoItemPrecificacaoEtiqueta.papelId (motor de clichê de
  // etiqueta) — uma gráfica rápida troca o papel carregado na impressora com
  // frequência maior do que cadastraria produtos novos pra cada combinação.
  folhas: FormatoFolhaInput[];
  // = ItemGrafica.precoCompra do papel escolhido — custo por FOLHA física
  // (não mais por peça: uma folha de 24-up custeia 24 peças de uma vez só,
  // igual ao Offset).
  custoPorFolha: number;
  // Achado B7 (correção de regressão do A2/2026-08-24): quando true, o
  // custoPorFolha=0 acima é INTENCIONAL (o cliente trouxe o material) —
  // distingue de "gráfica esqueceu de cadastrar precoCompra", que continua
  // barrado por validarPedidoDigital. nUp/numeroFolhas continuam calculados
  // normalmente mesmo assim — a impressora ainda processa fisicamente as
  // folhas trazidas pelo cliente, então cliques continuam sendo cobrados.
  materialFornecidoPeloCliente?: boolean;
};

// ---------- Parâmetros da impressora digital (custo de máquina, só DIGITAL) ----------

export type ParametrosImpressoraDigital = {
  custoPorClique: number;
};

// ---------- Cenário 6 (setup por peça — SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE/PERSONALIZACAO, sem nesting) ----------

export type PedidoSetupPorPeca = {
  quantidade: number; // Q
  numeroSetups: number; // nº de telas/matrizes/artes
  // Mesma razão de PedidoDigital.larguraM/alturaM acima — opcionais, só pra
  // alimentar um eventual acabamento M2-based.
  larguraM?: number;
  alturaM?: number;
};

// Achado A2 da auditoria de abrangência (2026-08-24): custoPorPeca em
// ParametrosMaquinaSetupPorPeca é custo de MÁQUINA (estampar/aplicar), não
// da peça física em branco (camiseta/caneca/boné/squeeze) — mesma separação
// que ContextoDigital.custoSubstratoPorPeca já faz pro Digital. Sem isso o
// motor precificava a peça em branco a R$0.
export type ContextoSetupPorPeca = {
  custoSubstratoPorPeca: number; // = ItemGrafica.precoCompra do produto, mesma fonte que Digital já usa
};

// ---------- Parâmetros da máquina de setup por peça (custo de máquina, os 3 modelos acima) ----------

export type ParametrosMaquinaSetupPorPeca = {
  custoPorSetup: number; // R$ por tela/matriz/arte
  custoPorPeca: number; // variável por peça
  custoMinimo: number; // piso do job
};

// ---------- Cenário 7 (revenda/terceirização — achado A12, sem nesting, sem máquina) ----------

export type PedidoRevenda = {
  quantidade: number; // Q
  // Revenda não precisa de dimensões pro CUSTO em si (sem nesting, sem
  // máquina) — mesmo motivo de PedidoDigital/PedidoSetupPorPeca acima:
  // opcionais, só pra alimentar um eventual acabamento M2-based.
  larguraM?: number;
  alturaM?: number;
};

// custoAquisicaoUnitario vem de OrcamentoItem.custoAquisicaoUnitario (override
// por orçamento) quando preenchido, ou de ItemGrafica.precoCompra do catálogo
// como default — mesmo padrão de fallback que ContextoDigital/
// ContextoSetupPorPeca já usam a partir de precoCompra (ver
// src/lib/pricing/carregar.ts).
export type ContextoRevenda = {
  custoAquisicaoUnitario: number;
};

// ---------- Cenário 8 (bordado — achado A4, sem nesting) ----------

export type PedidoBordado = {
  quantidade: number; // Q
  numeroPontos: number; // pontos da arte deste pedido — driver de custo POR PEDIDO
  // Mesma razão de PedidoDigital/PedidoSetupPorPeca/PedidoRevenda acima —
  // opcionais, só pra alimentar um eventual acabamento M2-based.
  larguraM?: number;
  alturaM?: number;
};

// Mesmo papel de ContextoSetupPorPeca (achado A2/B7) — custo da peça em
// branco (camiseta, boné) sobre a qual o bordado é aplicado, vindo de
// ItemGrafica.precoCompra. materialFornecidoPeloCliente (achado B7) zera
// esse custo quando o cliente já traz a peça.
export type ContextoBordado = {
  custoSubstratoPorPeca: number;
  materialFornecidoPeloCliente?: boolean;
};

// ---------- Parâmetros da máquina de bordado (custo de máquina, só BORDADO) ----------

export type ParametrosMaquinaBordado = {
  custoPorMilPontos: number;
  custoMatrizDigitalizacao: number; // 1× por pedido, não escala com Q — mesmo princípio do clichê de etiqueta
  custoMinimo: number; // piso do job — 0 quando a máquina não tem piso cadastrado
};

// ---------- Cenário 9 (tempo de máquina — achado A6, sem nesting) ----------

export type PedidoTempoMaquina = {
  quantidade: number; // Q
  // A gráfica escolhe a base na máquina (tempo, metro de corte, ou os dois
  // somados) — ambos opcionais e independentes, ver calcularTempoMaquina.
  // Ao menos um dos dois precisa estar preenchido (validado em validar.ts).
  tempoEstimadoMin?: number;
  metrosCorte?: number;
  // Mesma razão de PedidoDigital acima — opcionais, só pra alimentar um
  // eventual acabamento M2-based.
  larguraM?: number;
  alturaM?: number;
};

export type ContextoTempoMaquina = Record<string, never>;

// ---------- Parâmetros da máquina de tempo (custo de máquina, só TEMPO_MAQUINA) ----------

export type ParametrosMaquinaTempo = {
  custoHoraMaq: number;
  custoSetupPorJob: number; // 1× por item, não escala com Q
  custoMinimo: number; // piso do job — 0 quando a máquina não tem piso cadastrado
  custoPorMetroCorte: number; // 0 quando a máquina não cobra por metro de corte
};
