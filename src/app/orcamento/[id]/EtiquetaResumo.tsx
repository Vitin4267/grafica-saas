// Resumo somente-leitura dos ~18 campos de etiqueta de um item M2 —
// compartilhado entre a tela interna (page.tsx) e a pública (o/[token]/page.tsx).
// O PDF (OrcamentoDocumento.tsx, @react-pdf/renderer) não usa este componente
// — react-pdf não renderiza JSX de DOM normal, tem sua própria versão lá.
export type EtiquetaResumoDados = {
  materialSubstrato: string | null;
  materialSubstratoOutro: string | null;
  tipoAdesivo: string | null;
  tipoAdesivoOutro: string | null;
  superficieAplicacao: string | null;
  superficieAplicacaoOutro: string | null;
  formatoEtiqueta: string | null;
  coresRotulo: number | null;
  coresContraRotulo: number | null;
  embalagemQtdPorRolo: number | null;
  tubeteMedida: string | null;
  rotulagem: string | null;
  serrilha: string | null;
  serrilhaOutro: string | null;
  vernizRotuloTotal: boolean;
  vernizRotuloReserva: boolean;
  vernizRotuloTipo: string | null;
  vernizRotuloTipoOutro: string | null;
  vernizContraRotuloTotal: boolean;
  vernizContraRotuloReserva: boolean;
  vernizContraRotuloTipo: string | null;
  vernizContraRotuloTipoOutro: string | null;
  laminacaoRotulo: string | null;
  laminacaoRotuloOutro: string | null;
  laminacaoContraRotulo: string | null;
  laminacaoContraRotuloOutro: string | null;
  rebobinamento: number | null;
  hotStampings: {
    lado: string;
    tipo: string;
    tipoOutro: string | null;
    medida: string | null;
    cor: string | null;
  }[];
};

const ROTULO_MATERIAL_SUBSTRATO: Record<string, string> = {
  PAPEL_TERMICO: "Papel Térmico",
  COUCHE_C_ROT: "Couchê C/ROT",
  BOPP_METALIZADO_ROT: "BOPP Metalizado ROT",
  BOPP_BCO_PEROLIZADO: "BOPP Bco Perolizado",
  BOPP_BCO_FOSCO: "BOPP Bco Fosco",
  BOPP_TRANSPARENTE: "BOPP Transparente",
  L2_SEM_ADESIVO: "L2 - Sem Adesivo",
  POLIETILENO_BRANCO: "Polietileno Branco",
  POLIETILENO_TRANSPARENTE: "Polietileno Transp.",
  POLIESTER_BRANCO: "Poliéster Branco",
  POLIESTER_TRANSPARENTE: "Poliéster Transparente",
  POLIESTER_CROMO_FOSCO: "Poliéster Cromo Fosco",
  ELETROSTATICO_SEM_COLA: "Eletrostático sem cola",
  OUTRO: "Outro",
};
const ROTULO_TIPO_ADESIVO: Record<string, string> = {
  ACRILICO_20G: "Acrílico 20g",
  ACRILICO_30G: "Acrílico 30g",
  BORRACHA_20G: "Borracha 20g",
  BORRACHA_25G: "Borracha 25g",
  BORRACHA_30G: "Borracha 30g",
  BORRACHA_50G: "Borracha 50g",
};
const ROTULO_SUPERFICIE: Record<string, string> = {
  VIDRO: "Vidro",
  PLASTICO: "Plástico",
  METAL: "Metal",
  PAPEL: "Papel",
  PAPELAO: "Papelão",
  OUTROS: "Outros",
};
const ROTULO_ROTULAGEM: Record<string, string> = { MANUAL: "Manual", AUTOMATICA: "Automática" };
const ROTULO_SERRILHA: Record<string, string> = {
  SERRILHA: "Serrilha",
  MICRO_SERRILHA: "Micro serrilha",
  GAP: "Gap",
};
const ROTULO_LAMINACAO: Record<string, string> = { BRILHO: "Brilho", FOSCO: "Fosco" };
const ROTULO_VERNIZ: Record<string, string> = { BRILHO: "Brilho", FOSCO: "Fosco", RIBBON: "Ribbon" };
export const ROTULO_LADO: Record<string, string> = { ROTULO: "Rótulo", CONTRA_ROTULO: "Contra-rótulo" };
export const ROTULO_TIPO_HOT: Record<string, string> = { HOT: "Hot", COLD: "Cold" };

// Exportado pra ser reaproveitado por src/lib/pdf/mapear-dados.ts — mesmo
// raciocínio de linhasEtiqueta(): tipo=OUTRO mostra o texto livre pareado em
// vez do rótulo genérico "Outro".
export function rotuloTipoHotStamping(h: { tipo: string; tipoOutro: string | null }): string {
  return h.tipo === "OUTRO" && h.tipoOutro ? h.tipoOutro : (ROTULO_TIPO_HOT[h.tipo] ?? h.tipo);
}

// Exportado pra ser reaproveitado por src/lib/pdf/mapear-dados.ts — o PDF
// (@react-pdf/renderer) não pode renderizar este componente JSX diretamente
// (não é DOM normal), mas pode reusar essa função pura de rótulo/valor.
export function linhasEtiqueta(e: EtiquetaResumoDados): [string, string][] {
  const linhas: ([string, string] | null)[] = [
    e.materialSubstrato
      ? [
          "Material",
          e.materialSubstrato === "OUTRO" && e.materialSubstratoOutro
            ? e.materialSubstratoOutro
            : (ROTULO_MATERIAL_SUBSTRATO[e.materialSubstrato] ?? e.materialSubstrato),
        ]
      : null,
    e.tipoAdesivo
      ? [
          "Adesivo",
          e.tipoAdesivo === "OUTRO" && e.tipoAdesivoOutro
            ? e.tipoAdesivoOutro
            : (ROTULO_TIPO_ADESIVO[e.tipoAdesivo] ?? e.tipoAdesivo),
        ]
      : null,
    e.superficieAplicacao
      ? [
          "Aplicação",
          e.superficieAplicacao === "OUTROS" && e.superficieAplicacaoOutro
            ? e.superficieAplicacaoOutro
            : (ROTULO_SUPERFICIE[e.superficieAplicacao] ?? e.superficieAplicacao),
        ]
      : null,
    e.formatoEtiqueta ? ["Formato", e.formatoEtiqueta] : null,
    e.coresRotulo !== null ? ["Cores rótulo", String(e.coresRotulo)] : null,
    e.coresContraRotulo !== null ? ["Cores contra-rótulo", String(e.coresContraRotulo)] : null,
    e.embalagemQtdPorRolo !== null ? ["Por rolo", String(e.embalagemQtdPorRolo)] : null,
    e.tubeteMedida ? ["Tubete", e.tubeteMedida] : null,
    e.rotulagem ? ["Rotulagem", ROTULO_ROTULAGEM[e.rotulagem] ?? e.rotulagem] : null,
    e.serrilha
      ? [
          "Serrilha",
          e.serrilha === "OUTRO" && e.serrilhaOutro
            ? e.serrilhaOutro
            : (ROTULO_SERRILHA[e.serrilha] ?? e.serrilha),
        ]
      : null,
    e.rebobinamento !== null ? ["Rebobinamento", String(e.rebobinamento)] : null,
    e.vernizRotuloTotal || e.vernizRotuloReserva
      ? [
          "Verniz rótulo",
          `${[e.vernizRotuloTotal ? "total" : null, e.vernizRotuloReserva ? "reserva" : null]
            .filter(Boolean)
            .join(" + ")}${
            e.vernizRotuloTipo
              ? ` (${
                  e.vernizRotuloTipo === "OUTRO" && e.vernizRotuloTipoOutro
                    ? e.vernizRotuloTipoOutro
                    : (ROTULO_VERNIZ[e.vernizRotuloTipo] ?? e.vernizRotuloTipo)
                })`
              : ""
          }`,
        ]
      : null,
    e.vernizContraRotuloTotal || e.vernizContraRotuloReserva
      ? [
          "Verniz contra-rótulo",
          `${[e.vernizContraRotuloTotal ? "total" : null, e.vernizContraRotuloReserva ? "reserva" : null]
            .filter(Boolean)
            .join(" + ")}${
            e.vernizContraRotuloTipo
              ? ` (${
                  e.vernizContraRotuloTipo === "OUTRO" && e.vernizContraRotuloTipoOutro
                    ? e.vernizContraRotuloTipoOutro
                    : (ROTULO_VERNIZ[e.vernizContraRotuloTipo] ?? e.vernizContraRotuloTipo)
                })`
              : ""
          }`,
        ]
      : null,
    e.laminacaoRotulo
      ? [
          "Laminação rótulo",
          e.laminacaoRotulo === "OUTRO" && e.laminacaoRotuloOutro
            ? e.laminacaoRotuloOutro
            : (ROTULO_LAMINACAO[e.laminacaoRotulo] ?? e.laminacaoRotulo),
        ]
      : null,
    e.laminacaoContraRotulo
      ? [
          "Laminação contra-rótulo",
          e.laminacaoContraRotulo === "OUTRO" && e.laminacaoContraRotuloOutro
            ? e.laminacaoContraRotuloOutro
            : (ROTULO_LAMINACAO[e.laminacaoContraRotulo] ?? e.laminacaoContraRotulo),
        ]
      : null,
  ];
  return linhas.filter((l): l is [string, string] => l !== null);
}

export function EtiquetaResumo({ etiqueta }: { etiqueta: EtiquetaResumoDados }) {
  const linhas = linhasEtiqueta(etiqueta);
  if (linhas.length === 0 && etiqueta.hotStampings.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
      <p className="font-medium text-slate-500 dark:text-slate-400">Detalhes de etiqueta</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {linhas.map(([rotulo, valor]) => (
          <span key={rotulo}>
            {rotulo}: {valor}
          </span>
        ))}
      </div>
      {etiqueta.hotStampings.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {etiqueta.hotStampings.map((h, i) => (
            <span key={i}>
              Hot/cold stamping ({ROTULO_LADO[h.lado] ?? h.lado}): {rotuloTipoHotStamping(h)}
              {h.medida ? ` · ${h.medida}` : ""}
              {h.cor ? ` · ${h.cor}` : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
