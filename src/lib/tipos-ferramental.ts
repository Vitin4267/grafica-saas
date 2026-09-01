import type {
  TipoFerramental,
  ProprietarioFerramental,
  StatusFerramental,
} from "@/generated/prisma/enums";

// Achado F1 da Parte 7 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, "F. Documento e transação") — ver
// comentário do enum no schema.prisma. Lista fechada com OUTRO de escape,
// mesmo padrão de tipos-equipamento.ts.
export const ORDEM_TIPO_FERRAMENTAL: TipoFerramental[] = [
  "FACA_CORTE_VINCO",
  "CLICHE_FLEXO",
  "CLICHE_HOT_STAMPING",
  "TELA_SERIGRAFIA",
  "MATRIZ_BORDADO",
  "CILINDRO_ROTOGRAVURA",
  "FERRAMENTA_ACABAMENTO",
  "OUTRO",
];

export const ROTULO_TIPO_FERRAMENTAL: Record<TipoFerramental, string> = {
  FACA_CORTE_VINCO: "Faca de corte e vinco",
  CLICHE_FLEXO: "Clichê de flexografia",
  CLICHE_HOT_STAMPING: "Clichê de hot stamping",
  TELA_SERIGRAFIA: "Tela de serigrafia",
  MATRIZ_BORDADO: "Matriz de bordado",
  CILINDRO_ROTOGRAVURA: "Cilindro de rotogravura",
  FERRAMENTA_ACABAMENTO: "Ferramenta de acabamento",
  OUTRO: "Outro",
};

export const ORDEM_PROPRIETARIO_FERRAMENTAL: ProprietarioFerramental[] = ["GRAFICA", "CLIENTE"];

export const ROTULO_PROPRIETARIO_FERRAMENTAL: Record<ProprietarioFerramental, string> = {
  GRAFICA: "Da gráfica",
  CLIENTE: "Do cliente",
};

export const ORDEM_STATUS_FERRAMENTAL: StatusFerramental[] = [
  "ATIVO",
  "EM_MANUTENCAO",
  "DESCARTADO",
  "DEVOLVIDO_AO_CLIENTE",
];

export const ROTULO_STATUS_FERRAMENTAL: Record<StatusFerramental, string> = {
  ATIVO: "Ativo",
  EM_MANUTENCAO: "Em manutenção",
  DESCARTADO: "Descartado",
  DEVOLVIDO_AO_CLIENTE: "Devolvido ao cliente",
};

// Rótulo legível pra exibição/auditoria — cai pra tipoOutro quando o tipo é
// o escape hatch OUTRO (mesmo padrão de rotuloCategoria em
// configuracoes/maquinas/equipamentos/actions.ts).
export function rotuloTipoFerramental(tipo: TipoFerramental, tipoOutro: string | null): string {
  return tipo === "OUTRO" ? (tipoOutro ?? "Outro") : ROTULO_TIPO_FERRAMENTAL[tipo];
}
