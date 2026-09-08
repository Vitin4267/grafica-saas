import { describe, it, expect } from "vitest";
import { linhasEtiqueta, type EtiquetaResumoDados } from "./EtiquetaResumo";
import { ROTULO_REBOBINAMENTO } from "@/lib/orcamento-etiqueta";

// Objeto mínimo com todo campo "vazio" — cada teste sobrepõe só o que
// interessa (mesmo raciocínio de builder usado nos outros testes do
// domínio de etiqueta).
function etiquetaVazia(overrides: Partial<EtiquetaResumoDados> = {}): EtiquetaResumoDados {
  return {
    materialSubstrato: null,
    materialSubstratoOutro: null,
    tipoAdesivo: null,
    tipoAdesivoOutro: null,
    durabilidadeAdesivo: null,
    superficieAplicacao: null,
    superficieAplicacaoOutro: null,
    formatoEtiqueta: null,
    coresRotulo: null,
    coresContraRotulo: null,
    embalagemQtdPorRolo: null,
    tubeteMedida: null,
    rotulagem: null,
    serrilha: null,
    serrilhaOutro: null,
    vernizRotuloTotal: false,
    vernizRotuloReserva: false,
    vernizRotuloTipo: null,
    vernizRotuloTipoOutro: null,
    vernizContraRotuloTotal: false,
    vernizContraRotuloReserva: false,
    vernizContraRotuloTipo: null,
    vernizContraRotuloTipoOutro: null,
    laminacaoRotulo: null,
    laminacaoRotuloOutro: null,
    laminacaoContraRotulo: null,
    laminacaoContraRotuloOutro: null,
    rebobinamento: null,
    hotStampings: [],
    ...overrides,
  };
}

describe("linhasEtiqueta — rebobinamento", () => {
  it("não exibe a linha 'Rebobinamento' quando o valor é null (não informado)", () => {
    const linhas = linhasEtiqueta(etiquetaVazia({ rebobinamento: null }));
    expect(linhas.find(([rotulo]) => rotulo === "Rebobinamento")).toBeUndefined();
  });

  it("exibe o rótulo (não o número cru) quando o valor está definido", () => {
    const linhas = linhasEtiqueta(etiquetaVazia({ rebobinamento: 4 }));
    const linha = linhas.find(([rotulo]) => rotulo === "Rebobinamento");
    expect(linha).toEqual(["Rebobinamento", ROTULO_REBOBINAMENTO[4]]);
    // Nunca deve regredir pra mostrar só o número sem contexto.
    expect(linha?.[1]).not.toBe("4");
  });

  it("cobre os 8 valores possíveis com um rótulo cadastrado", () => {
    for (let n = 1; n <= 8; n++) {
      const linhas = linhasEtiqueta(etiquetaVazia({ rebobinamento: n }));
      const linha = linhas.find(([rotulo]) => rotulo === "Rebobinamento");
      expect(linha?.[1]).toBe(ROTULO_REBOBINAMENTO[n]);
    }
  });
});
