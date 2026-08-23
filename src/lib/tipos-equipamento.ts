import type { CategoriaEquipamento } from "@/generated/prisma/enums";

// Categorias reais de equipamento de gráfica, levantadas por pesquisa
// (2026-08-22) — cobre o que sobra fora de Offset/Flexografia (que já têm
// motor de custo próprio, ver Prensa/MaquinaFlexografia). `exemplos` é só
// texto de apoio no formulário (placeholder), nunca validado — a gráfica
// pode ter qualquer marca, inclusive nenhuma listada aqui.
export const ORDEM_CATEGORIA_EQUIPAMENTO: CategoriaEquipamento[] = [
  "GUILHOTINA",
  "LAMINADORA",
  "DOBRADEIRA",
  "ENCADERNADORA",
  "GRAMPEADEIRA",
  "PLOTTER_RECORTE",
  "IMPRESSORA_GRANDE_FORMATO",
  "OUTRO",
];

export const ROTULO_CATEGORIA_EQUIPAMENTO: Record<CategoriaEquipamento, string> = {
  GUILHOTINA: "Guilhotina",
  LAMINADORA: "Laminadora",
  DOBRADEIRA: "Dobradeira",
  ENCADERNADORA: "Encadernadora / espiral / wire-o",
  GRAMPEADEIRA: "Grampeadeira / alceadeira",
  PLOTTER_RECORTE: "Plotter de recorte",
  IMPRESSORA_GRANDE_FORMATO: "Impressora de grande formato",
  OUTRO: "Outro",
};

export const EXEMPLOS_MARCA_CATEGORIA_EQUIPAMENTO: Record<CategoriaEquipamento, string> = {
  GUILHOTINA: "ex: Polar, Guarani, Wohlenberg",
  LAMINADORA: "ex: Ricall, Foliant, GMP",
  DOBRADEIRA: "ex: Stahl, Herzog+Heymann",
  ENCADERNADORA: "ex: Duplo, Marpax, Wohlenberg",
  GRAMPEADEIRA: "ex: Müller Martini, CP Bourg, Duplo",
  PLOTTER_RECORTE: "ex: Roland, Summa, Graphtec",
  IMPRESSORA_GRANDE_FORMATO: "ex: Roland, Mimaki, HP Latex, Epson SureColor, Mutoh",
  OUTRO: "",
};
