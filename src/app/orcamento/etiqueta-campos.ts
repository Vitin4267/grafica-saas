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
  tipoOutro: string;
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
  tipoAdesivoOutro: string;
  superficieAplicacao: string;
  superficieAplicacaoOutro: string;
  formatoEtiqueta: string;
  coresRotulo: string;
  coresContraRotulo: string;
  embalagemQtdPorRolo: string;
  tubeteMedida: string;
  rotulagem: string;
  serrilha: string;
  serrilhaOutro: string;
  vernizRotuloTotal: boolean;
  vernizRotuloReserva: boolean;
  vernizRotuloTipo: string;
  vernizRotuloTipoOutro: string;
  vernizContraRotuloTotal: boolean;
  vernizContraRotuloReserva: boolean;
  vernizContraRotuloTipo: string;
  vernizContraRotuloTipoOutro: string;
  laminacaoRotulo: string;
  laminacaoRotuloOutro: string;
  laminacaoContraRotulo: string;
  laminacaoContraRotuloOutro: string;
  rebobinamento: string;
  hotStampings: CamposHotStamping[];
};

export function etiquetaInicial(): CamposEtiqueta {
  return {
    materialSubstrato: "",
    materialSubstratoOutro: "",
    tipoAdesivo: "",
    tipoAdesivoOutro: "",
    superficieAplicacao: "",
    superficieAplicacaoOutro: "",
    formatoEtiqueta: "",
    coresRotulo: "",
    coresContraRotulo: "",
    embalagemQtdPorRolo: "",
    tubeteMedida: "",
    rotulagem: "",
    serrilha: "",
    serrilhaOutro: "",
    vernizRotuloTotal: false,
    vernizRotuloReserva: false,
    vernizRotuloTipo: "",
    vernizRotuloTipoOutro: "",
    vernizContraRotuloTotal: false,
    vernizContraRotuloReserva: false,
    vernizContraRotuloTipo: "",
    vernizContraRotuloTipoOutro: "",
    laminacaoRotulo: "",
    laminacaoRotuloOutro: "",
    laminacaoContraRotulo: "",
    laminacaoContraRotuloOutro: "",
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
  hotStampings: { lado: string; tipo: string; tipoOutro: string | null; medida: string | null; cor: string | null }[];
} | null): CamposEtiqueta {
  if (!linha) return etiquetaInicial();
  return {
    materialSubstrato: linha.materialSubstrato ?? "",
    materialSubstratoOutro: linha.materialSubstratoOutro ?? "",
    tipoAdesivo: linha.tipoAdesivo ?? "",
    tipoAdesivoOutro: linha.tipoAdesivoOutro ?? "",
    superficieAplicacao: linha.superficieAplicacao ?? "",
    superficieAplicacaoOutro: linha.superficieAplicacaoOutro ?? "",
    formatoEtiqueta: linha.formatoEtiqueta ?? "",
    coresRotulo: linha.coresRotulo?.toString() ?? "",
    coresContraRotulo: linha.coresContraRotulo?.toString() ?? "",
    embalagemQtdPorRolo: linha.embalagemQtdPorRolo?.toString() ?? "",
    tubeteMedida: linha.tubeteMedida ?? "",
    rotulagem: linha.rotulagem ?? "",
    serrilha: linha.serrilha ?? "",
    serrilhaOutro: linha.serrilhaOutro ?? "",
    vernizRotuloTotal: linha.vernizRotuloTotal,
    vernizRotuloReserva: linha.vernizRotuloReserva,
    vernizRotuloTipo: linha.vernizRotuloTipo ?? "",
    vernizRotuloTipoOutro: linha.vernizRotuloTipoOutro ?? "",
    vernizContraRotuloTotal: linha.vernizContraRotuloTotal,
    vernizContraRotuloReserva: linha.vernizContraRotuloReserva,
    vernizContraRotuloTipo: linha.vernizContraRotuloTipo ?? "",
    vernizContraRotuloTipoOutro: linha.vernizContraRotuloTipoOutro ?? "",
    laminacaoRotulo: linha.laminacaoRotulo ?? "",
    laminacaoRotuloOutro: linha.laminacaoRotuloOutro ?? "",
    laminacaoContraRotulo: linha.laminacaoContraRotulo ?? "",
    laminacaoContraRotuloOutro: linha.laminacaoContraRotuloOutro ?? "",
    rebobinamento: linha.rebobinamento?.toString() ?? "",
    hotStampings: linha.hotStampings.map((h) => ({
      chave: gerarChave(),
      lado: h.lado,
      tipo: h.tipo,
      tipoOutro: h.tipoOutro ?? "",
      medida: h.medida ?? "",
      cor: h.cor ?? "",
    })),
  };
}
