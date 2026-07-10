export type ModeloCalculo = "SIMPLES" | "M2" | "OFFSET";
export type BaseCobranca =
  | "UNIDADE"
  | "M2"
  | "FOLHA_IMPRESSA"
  | "METRO_LINEAR"
  | "FIXO"
  | "HORA";
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

  custoHoraMaq: number;
  torres: number;
  custoChapa: number;
  folhasAcerto: number;
  tempoAcertoH: number;
  custoMilheiroRod: number;
  rodagemMinima: number;
  perdaPercentPadrao: number;

  margemSegurancaPadrao: number;
  gapPecasPadrao: number;
};
