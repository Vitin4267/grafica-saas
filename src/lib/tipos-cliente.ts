import type {
  OrigemCliente,
  SegmentoCliente,
  TipoPessoa,
  IndicadorInscricaoEstadual,
  FormaPagamento,
} from "@/generated/prisma/enums";

// Canal de aquisição do cliente (achado A11 da auditoria de abrangência,
// pesquisa-abrangencia-modulos.md) — mesmo padrão enum-fechado+OUTRO do
// resto do schema (ver ORDEM_CATEGORIA_EQUIPAMENTO em tipos-equipamento.ts).
// CLIENTE_ANTIGO é distinto de INDICACAO: cliente que já comprou antes e
// voltou por conta própria, sem ninguém ter indicado.
export const ORDEM_ORIGEM_CLIENTE: OrigemCliente[] = [
  "INDICACAO",
  "REDES_SOCIAIS",
  "BUSCA_GOOGLE",
  "ANUNCIO",
  "FEIRA_EVENTO",
  "PROSPECCAO_ATIVA",
  "CLIENTE_ANTIGO",
  "OUTRO",
];

export const ROTULO_ORIGEM_CLIENTE: Record<OrigemCliente, string> = {
  INDICACAO: "Indicação",
  REDES_SOCIAIS: "Redes sociais",
  BUSCA_GOOGLE: "Busca no Google",
  ANUNCIO: "Anúncio",
  FEIRA_EVENTO: "Feira/evento",
  PROSPECCAO_ATIVA: "Prospecção ativa",
  CLIENTE_ANTIGO: "Cliente antigo que voltou",
  OUTRO: "Outro",
};

// Segmento comercial do cliente (achado A7 da auditoria de abrangência,
// "Nível 1") — mesmo padrão enum-fechado+OUTRO de ORDEM_ORIGEM_CLIENTE
// acima. REVENDA_AGENCIA é o caso que motivou o achado: gráfica que vende
// pra revenda/agência com margem menor que venda direta ao consumidor
// (VAREJO) — ver Cliente.margemPadraoOverride no schema.
export const ORDEM_SEGMENTO_CLIENTE: SegmentoCliente[] = [
  "VAREJO",
  "EMPRESA",
  "REVENDA_AGENCIA",
  "INDUSTRIA",
  "ORGAO_PUBLICO",
  "OUTRO",
];

export const ROTULO_SEGMENTO_CLIENTE: Record<SegmentoCliente, string> = {
  VAREJO: "Varejo",
  EMPRESA: "Empresa",
  REVENDA_AGENCIA: "Revenda/Agência",
  INDUSTRIA: "Indústria",
  ORGAO_PUBLICO: "Órgão público",
  OUTRO: "Outro",
};

// Distinção Pessoa Física × Pessoa Jurídica (achado A1 da auditoria de
// abrangência) — sem OUTRO de propósito, ver comentário do enum no schema.
export const ORDEM_TIPO_PESSOA: TipoPessoa[] = ["FISICA", "JURIDICA"];

export const ROTULO_TIPO_PESSOA: Record<TipoPessoa, string> = {
  FISICA: "Pessoa física",
  JURIDICA: "Pessoa jurídica",
};

// Indicador de contribuinte de ICMS do destinatário (tag indIEDest da NF-e
// 4.0, achado A1 da auditoria de abrangência) — decide se a Inscrição
// Estadual é obrigatória (CONTRIBUINTE) ou proibida (ISENTO) na emissão.
export const ORDEM_INDICADOR_INSCRICAO_ESTADUAL: IndicadorInscricaoEstadual[] = [
  "CONTRIBUINTE",
  "ISENTO",
  "NAO_CONTRIBUINTE",
];

export const ROTULO_INDICADOR_INSCRICAO_ESTADUAL: Record<IndicadorInscricaoEstadual, string> = {
  CONTRIBUINTE: "Contribuinte de ICMS",
  ISENTO: "Contribuinte isento de Inscrição Estadual",
  NAO_CONTRIBUINTE: "Não contribuinte",
};

// Forma de pagamento preferida do cliente (achado A6 da Parte 5 da auditoria
// de abrangência) — reusa o enum FormaPagamento que já existe em
// Pagamento.forma/ContaReceber, zero conceito novo. Sem OUTRO de propósito:
// diferente de origem/segmento, este valor é só uma sugestão de
// preenchimento (condicoesPagamento do orçamento), nunca gravado como valor
// final em lugar nenhum — não vale a pena o campo extra "*Outro" pra isso.
export const ORDEM_FORMA_PAGAMENTO_CLIENTE: FormaPagamento[] = [
  "PIX",
  "BOLETO",
  "CARTAO",
  "TRANSFERENCIA",
  "DINHEIRO",
  "OUTRO",
];

export const ROTULO_FORMA_PAGAMENTO_CLIENTE: Record<FormaPagamento, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  CARTAO: "Cartão",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outro",
};
