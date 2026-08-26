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
  | "REVENDA";
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
  areaMinimaFaturavel: number; // ItemGrafica.areaMinimaFaturavel do produto (m², métrica de auditoria)
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
};

// ---------- Cenário 3 (acabamento) ----------

export type ConfigAcabamento = {
  itemGraficaId: string;
  nome: string;
  baseCobranca: BaseCobranca;
  estagio: EstagioAcabamento;
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
  pedidoMinimo: number;
  incrementoArredondamento: number;

  margemSegurancaPadrao: number;
  gapPecasPadrao: number;
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

// ---------- Cenário 5 (digital, sem nesting) ----------

export type PedidoDigital = {
  quantidade: number; // Q
  numeroCliques?: number; // default 1 (1 clique por peça) se omitido
  // Digital não precisa de dimensões pro CUSTO em si (sem nesting) — opcionais
  // de propósito, ao contrário de M2/OFFSET/FLEXOGRAFIA. Só existem aqui pra
  // alimentar um eventual acabamento anexado com baseCobranca=M2 (ver
  // ctxAcabamento em precificar.ts); ausentes = 0, e orcamento-precificacao.ts
  // bloqueia ANTES de chegar aqui se esse acabamento existir sem elas
  // (evita R$0 silencioso).
  larguraM?: number;
  alturaM?: number;
};

export type ContextoDigital = {
  custoSubstratoPorPeca: number; // = ItemGrafica.precoCompra do material, mesma fonte que M2 já usa
  // Achado B7 (correção de regressão do A2/2026-08-24): quando true, o
  // custoSubstratoPorPeca=0 acima é INTENCIONAL (o cliente trouxe a peça em
  // branco) — distingue de "gráfica esqueceu de cadastrar precoCompra", que
  // continua barrado por validarPedidoDigital. Sem essa distinção, o guard
  // de silêncio (calcularQtdBase/validarPedidoDigital) rejeitava o zero
  // legítimo do B7 com o mesmo erro genérico de configuração ausente.
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
