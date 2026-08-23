import type { CategoriaEquipamento } from "@/generated/prisma/enums";

// Categorias reais de equipamento de gráfica, levantadas por pesquisa
// (2026-08-22, expandida em 2026-08-23) — cobre o que sobra fora de
// Offset/Flexografia (que já têm motor de custo próprio, ver
// Prensa/MaquinaFlexografia). `exemplos` é só texto de apoio no formulário
// (placeholder), nunca validado — a gráfica pode ter qualquer marca,
// inclusive nenhuma listada aqui. Onde a pesquisa não achou marca
// brasileira consolidada o bastante (serigrafia, estampagem a quente),
// o hint descreve a função em vez de arriscar um nome de marca.
export const ORDEM_CATEGORIA_EQUIPAMENTO: CategoriaEquipamento[] = [
  "GUILHOTINA",
  "LAMINADORA",
  "DOBRADEIRA",
  "ENCADERNADORA",
  "GRAMPEADEIRA",
  "CTP",
  "IMPRESSORA_DIGITAL",
  "IMPRESSORA_GRANDE_FORMATO",
  "PLOTTER_RECORTE",
  "CORTE_LASER_ROUTER",
  "SERIGRAFIA",
  "SUBLIMACAO",
  "ESTAMPAGEM_QUENTE",
  "OUTRO",
];

export const ROTULO_CATEGORIA_EQUIPAMENTO: Record<CategoriaEquipamento, string> = {
  GUILHOTINA: "Guilhotina",
  LAMINADORA: "Laminadora",
  DOBRADEIRA: "Dobradeira",
  ENCADERNADORA: "Encadernadora / espiral / wire-o",
  GRAMPEADEIRA: "Grampeadeira / alceadeira",
  CTP: "CTP (chapeadora)",
  IMPRESSORA_DIGITAL: "Impressora digital (pequeno formato)",
  IMPRESSORA_GRANDE_FORMATO: "Impressora de grande formato",
  PLOTTER_RECORTE: "Plotter de recorte",
  CORTE_LASER_ROUTER: "Router CNC / corte a laser",
  SERIGRAFIA: "Serigrafia",
  SUBLIMACAO: "Sublimação",
  ESTAMPAGEM_QUENTE: "Estampagem a quente (hot stamping)",
  OUTRO: "Outro",
};

export const EXEMPLOS_MARCA_CATEGORIA_EQUIPAMENTO: Record<CategoriaEquipamento, string> = {
  GUILHOTINA: "ex: Polar, Guarani, Wohlenberg",
  LAMINADORA: "ex: Ricall, Foliant, GMP",
  DOBRADEIRA: "ex: Stahl, Herzog+Heymann",
  ENCADERNADORA: "ex: Duplo, Marpax, Wohlenberg",
  GRAMPEADEIRA: "ex: Müller Martini, CP Bourg, Duplo",
  CTP: "ex: Agfa, Kodak, Fujifilm, Heidelberg Suprasetter",
  IMPRESSORA_DIGITAL: "ex: HP Indigo, Xerox, Konica Minolta, Canon, Ricoh",
  IMPRESSORA_GRANDE_FORMATO: "ex: Roland, Mimaki, HP Latex, Epson SureColor, Mutoh",
  PLOTTER_RECORTE: "ex: Roland, Summa, Graphtec",
  CORTE_LASER_ROUTER: "ex: Visutec, MultiCam",
  SERIGRAFIA: "mesa ou carrossel serigráfico, manual ou automático",
  SUBLIMACAO: "prensa térmica (ex: Metalnox, MAQmei) + impressora (ex: Epson SureColor F)",
  ESTAMPAGEM_QUENTE: "aplica filme metalizado/pigmentado com calor e pressão",
  OUTRO: "",
};
