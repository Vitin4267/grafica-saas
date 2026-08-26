import type { OrigemCliente, SegmentoCliente } from "@/generated/prisma/enums";

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
