// Tipos + funções PURAS de conversão pra CamposEtiqueta — extraído de
// CamposEtiquetaOrcamento.tsx (que é "use client") de propósito: page.tsx
// (Server Component) precisa chamar etiquetaParaCampos() diretamente pra
// montar valoresIniciais, e React Server Components proíbe invocar uma
// função vinda de um módulo "use client" (só permite renderizar seus
// Componentes como JSX) — sem este arquivo separado, isso quebra em runtime
// com "Attempted to call etiquetaParaCampos() from the server but
// etiquetaParaCampos is on the client" (só aparece ao navegar de verdade,
// não pega no build nem no typecheck, porque /orcamento/[id] é rota
// dinâmica, não estática).
import { gerarChave } from "@/lib/chave-local";

export type CamposHotStamping = {
  chave: string;
  lado: string;
  tipo: string;
  medida: string;
  cor: string;
};

// Detalhe descritivo/de produção de etiqueta — todo campo é string (mesmo os
// numéricos) porque isso vem de <input>/<select> controlados, igual o resto
// de CamposItemOrcamento. Só relevante quando o item usa modeloCalculo=M2.
export type CamposEtiqueta = {
  materialSubstrato: string;
  materialSubstratoOutro: string;
  tipoAdesivo: string;
  superficieAplicacao: string;
  formatoEtiqueta: string;
  coresRotulo: string;
  coresContraRotulo: string;
  embalagemQtdPorRolo: string;
  tubeteMedida: string;
  rotulagem: string;
  serrilha: string;
  vernizRotuloTotal: boolean;
  vernizRotuloReserva: boolean;
  vernizRotuloTipo: string;
  vernizContraRotuloTotal: boolean;
  vernizContraRotuloReserva: boolean;
  vernizContraRotuloTipo: string;
  laminacaoRotulo: string;
  laminacaoContraRotulo: string;
  rebobinamento: string;
  hotStampings: CamposHotStamping[];
};

export function etiquetaInicial(): CamposEtiqueta {
  return {
    materialSubstrato: "",
    materialSubstratoOutro: "",
    tipoAdesivo: "",
    superficieAplicacao: "",
    formatoEtiqueta: "",
    coresRotulo: "",
    coresContraRotulo: "",
    embalagemQtdPorRolo: "",
    tubeteMedida: "",
    rotulagem: "",
    serrilha: "",
    vernizRotuloTotal: false,
    vernizRotuloReserva: false,
    vernizRotuloTipo: "",
    vernizContraRotuloTotal: false,
    vernizContraRotuloReserva: false,
    vernizContraRotuloTipo: "",
    laminacaoRotulo: "",
    laminacaoContraRotulo: "",
    rebobinamento: "",
    hotStampings: [],
  };
}

// Inverso de etiquetaInicial() — carrega os valores já salvos (linha do
// banco, tudo null/number/boolean) pro formato controlado (tudo string) que
// CamposEtiquetaOrcamento.tsx edita. Chamado tanto no servidor (page.tsx,
// pra montar valoresIniciais) quanto no cliente (EditarOrcamentoForm.tsx).
export function etiquetaParaCampos(linha: {
  materialSubstrato: string | null;
  materialSubstratoOutro: string | null;
  tipoAdesivo: string | null;
  superficieAplicacao: string | null;
  formatoEtiqueta: string | null;
  coresRotulo: number | null;
  coresContraRotulo: number | null;
  embalagemQtdPorRolo: number | null;
  tubeteMedida: string | null;
  rotulagem: string | null;
  serrilha: string | null;
  vernizRotuloTotal: boolean;
  vernizRotuloReserva: boolean;
  vernizRotuloTipo: string | null;
  vernizContraRotuloTotal: boolean;
  vernizContraRotuloReserva: boolean;
  vernizContraRotuloTipo: string | null;
  laminacaoRotulo: string | null;
  laminacaoContraRotulo: string | null;
  rebobinamento: number | null;
  hotStampings: { lado: string; tipo: string; medida: string | null; cor: string | null }[];
} | null): CamposEtiqueta {
  if (!linha) return etiquetaInicial();
  return {
    materialSubstrato: linha.materialSubstrato ?? "",
    materialSubstratoOutro: linha.materialSubstratoOutro ?? "",
    tipoAdesivo: linha.tipoAdesivo ?? "",
    superficieAplicacao: linha.superficieAplicacao ?? "",
    formatoEtiqueta: linha.formatoEtiqueta ?? "",
    coresRotulo: linha.coresRotulo?.toString() ?? "",
    coresContraRotulo: linha.coresContraRotulo?.toString() ?? "",
    embalagemQtdPorRolo: linha.embalagemQtdPorRolo?.toString() ?? "",
    tubeteMedida: linha.tubeteMedida ?? "",
    rotulagem: linha.rotulagem ?? "",
    serrilha: linha.serrilha ?? "",
    vernizRotuloTotal: linha.vernizRotuloTotal,
    vernizRotuloReserva: linha.vernizRotuloReserva,
    vernizRotuloTipo: linha.vernizRotuloTipo ?? "",
    vernizContraRotuloTotal: linha.vernizContraRotuloTotal,
    vernizContraRotuloReserva: linha.vernizContraRotuloReserva,
    vernizContraRotuloTipo: linha.vernizContraRotuloTipo ?? "",
    laminacaoRotulo: linha.laminacaoRotulo ?? "",
    laminacaoContraRotulo: linha.laminacaoContraRotulo ?? "",
    rebobinamento: linha.rebobinamento?.toString() ?? "",
    hotStampings: linha.hotStampings.map((h) => ({
      chave: gerarChave(),
      lado: h.lado,
      tipo: h.tipo,
      medida: h.medida ?? "",
      cor: h.cor ?? "",
    })),
  };
}
