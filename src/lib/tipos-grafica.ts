import type { SegmentoGrafica } from "@/generated/prisma/enums";

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
  OUTRO: "Outro",
};
