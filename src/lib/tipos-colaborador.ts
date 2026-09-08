import type { TipoColaborador } from "@/generated/prisma/enums";

// Achado D1 da auditoria de abrangência (Parte 4/Qualidade-pessoas,
// pesquisa-abrangencia-modulos.md) — ver comentário do model Colaborador em
// prisma/schema/03-usuarios-auth.prisma. Lista fechada com OUTRO de escape,
// mesmo padrão de tipos-prestador-servico.ts/tipos-ferramental.ts.
export const ORDEM_TIPO_COLABORADOR: TipoColaborador[] = [
  "MOTORISTA",
  "OPERADOR_CHAO_FABRICA",
  "OUTRO",
];

export const ROTULO_TIPO_COLABORADOR: Record<TipoColaborador, string> = {
  MOTORISTA: "Motorista",
  OPERADOR_CHAO_FABRICA: "Operador de chão de fábrica",
  OUTRO: "Outro",
};

// Rótulo legível pra exibição/auditoria — cai pra tipoOutro quando o tipo é
// o escape hatch OUTRO (mesmo padrão de rotuloTipoPrestadorServico).
export function rotuloTipoColaborador(tipo: TipoColaborador, tipoOutro: string | null): string {
  return tipo === "OUTRO" ? (tipoOutro ?? "Outro") : ROTULO_TIPO_COLABORADOR[tipo];
}
