import type { TipoPrestadorServico } from "@/generated/prisma/enums";

// Achado D2 da Parte 7 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, "D. Equipe e prestadores externos") —
// ver comentário do model PrestadorServico em prisma/schema/08-compras.prisma.
// Lista fechada com OUTRO de escape, mesmo padrão de tipos-ferramental.ts.
export const ORDEM_TIPO_PRESTADOR_SERVICO: TipoPrestadorServico[] = [
  "ACABAMENTO",
  "LOGISTICA",
  "DESIGN",
  "OUTRO",
];

export const ROTULO_TIPO_PRESTADOR_SERVICO: Record<TipoPrestadorServico, string> = {
  ACABAMENTO: "Acabamento terceirizado",
  LOGISTICA: "Logística",
  DESIGN: "Design",
  OUTRO: "Outro",
};

// Rótulo legível pra exibição/auditoria — cai pra tipoOutro quando o tipo é
// o escape hatch OUTRO (mesmo padrão de rotuloTipoFerramental).
export function rotuloTipoPrestadorServico(
  tipo: TipoPrestadorServico,
  tipoOutro: string | null
): string {
  return tipo === "OUTRO" ? (tipoOutro ?? "Outro") : ROTULO_TIPO_PRESTADOR_SERVICO[tipo];
}
