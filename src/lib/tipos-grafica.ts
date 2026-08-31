import type { SegmentoGrafica, TipoChavePix } from "@/generated/prisma/enums";

// Perfil de negócio da GRÁFICA — achado A6 da Parte 6 da auditoria de
// abrangência (2026-08-27), mesmo padrão enum-fechado+OUTRO de
// tipos-cliente.ts (ORDEM_SEGMENTO_CLIENTE/ROTULO_SEGMENTO_CLIENTE). Ver
// comentário do enum SegmentoGrafica no schema: descritivo, nunca
// restritivo — só semeia defaults (categorias de custo sugeridas em
// src/lib/custo-pedido.ts, pacote de dados de exemplo em
// src/lib/dados-exemplo.ts), nunca trava o que a gráfica pode cadastrar.
export const ORDEM_SEGMENTO_GRAFICA: SegmentoGrafica[] = [
  "ROTULOS_ETIQUETAS",
  "OFFSET_COMERCIAL",
  "COMUNICACAO_VISUAL",
  "ESTAMPARIA_VESTUARIO",
  "BRINDES_PERSONALIZADOS",
  "EMBALAGEM_CARTONAGEM",
  "EDITORIAL_LIVRO",
  "CORTE_LASER_ACRILICO",
  "GRAFICA_RAPIDA",
  // Leva 2 (achado F9 da Parte 7 da auditoria de abrangência, 2026-08-31) —
  // ver comentário do enum SegmentoGrafica no schema.
  "SERIGRAFIA",
  "FLEXOGRAFIA",
  "BORDADO",
  "PAPELARIA_CONVITES",
  "SINALIZACAO_ADESIVAGEM",
  "OUTRO",
];

export const ROTULO_SEGMENTO_GRAFICA: Record<SegmentoGrafica, string> = {
  ROTULOS_ETIQUETAS: "Rótulos e etiquetas",
  OFFSET_COMERCIAL: "Offset comercial",
  COMUNICACAO_VISUAL: "Comunicação visual",
  ESTAMPARIA_VESTUARIO: "Estamparia e vestuário",
  BRINDES_PERSONALIZADOS: "Brindes personalizados",
  EMBALAGEM_CARTONAGEM: "Embalagem e cartonagem",
  EDITORIAL_LIVRO: "Editorial e livros",
  CORTE_LASER_ACRILICO: "Corte a laser e acrílico",
  GRAFICA_RAPIDA: "Gráfica rápida",
  SERIGRAFIA: "Serigrafia",
  FLEXOGRAFIA: "Flexografia",
  BORDADO: "Bordado",
  PAPELARIA_CONVITES: "Papelaria e convites",
  SINALIZACAO_ADESIVAGEM: "Sinalização e adesivagem",
  OUTRO: "Outro",
};

// Opções pro multi-select de `Grafica.segmentosSecundarios` (achado F9 da
// Parte 7, 2026-08-31) — mesma lista de ORDEM_SEGMENTO_GRAFICA, mas sem
// OUTRO: não há campo-irmão "segmentosSecundariosOutro" pra descrever um
// valor livre aqui (ver comentário do campo no schema), então OUTRO não
// agregaria nada de útil como opção secundária.
export const ORDEM_SEGMENTO_GRAFICA_SECUNDARIO: SegmentoGrafica[] =
  ORDEM_SEGMENTO_GRAFICA.filter((valor) => valor !== "OUTRO");

// Tipo de chave PIX cadastrada em Grafica.chavePix — achado F6 da Parte 7 da
// auditoria de abrangência (2026-08-31). Só rotula o campo pra exibição
// ("Chave PIX (CPF): ..."), nunca valida o formato do valor digitado (ver
// comentário do enum TipoChavePix no schema).
export const ORDEM_TIPO_CHAVE_PIX: TipoChavePix[] = [
  "CPF",
  "CNPJ",
  "EMAIL",
  "TELEFONE",
  "ALEATORIA",
  "OUTRO",
];

export const ROTULO_TIPO_CHAVE_PIX: Record<TipoChavePix, string> = {
  CPF: "CPF",
  CNPJ: "CNPJ",
  EMAIL: "E-mail",
  TELEFONE: "Telefone",
  ALEATORIA: "Chave aleatória",
  OUTRO: "Outro",
};
