import { describe, it, expect } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { mapearDadosPdf, type OrcamentoParaPdf } from "./mapear-dados";

// Fixture mínima — só o suficiente pra mapearDadosPdf rodar sem lançar.
// Decimal "reais" do Prisma não são necessários aqui: mapearDadosPdf só chama
// Number()/toString() neles, que funcionam igual com um number puro (mesmo
// cast usado em orcamento-precificacao.test.ts).
function orcamentoBase(
  itemOverrides: Partial<OrcamentoParaPdf["itens"][number]> = {}
): OrcamentoParaPdf {
  return {
    status: "ENVIADO",
    createdAt: new Date("2026-08-24"),
    total: 100 as unknown as Prisma.Decimal,
    respostaPublicaNome: null,
    respostaPublicaEm: null,
    validoAteEm: null,
    toleranciaTiragemPercent: null,
    cliente: { nome: "Cliente Teste" },
    grafica: {
      nome: "Gráfica Teste",
      logoUrl: null,
      corPrimaria: null,
      telefone: null,
      emailContato: null,
      site: null,
      enderecoResumido: null,
      parametros: { termosCondicoesPdf: null, mostrarEspecificacoesTecnicas: true },
    },
    vendedor: null,
    tipoPedido: null,
    condicoesPagamento: null,
    frete: null,
    transportadora: null,
    localEntrega: null,
    prazoEntregaEstimadoDias: null,
    itens: [
      {
        quantidade: 100,
        larguraCm: null,
        alturaCm: null,
        unidadeDimensao: "CM",
        cores: null,
        acabamento: null,
        descricaoLivre: null,
        acabamentos: [],
        precoUnitario: 1 as unknown as Prisma.Decimal,
        precoTotal: 100 as unknown as Prisma.Decimal,
        itemGrafica: {
          itemCatalogo: { nome: "Banner em Lona" },
          unidadeContagem: null,
          fatorConversao: null,
        },
        etiqueta: null,
        ...itemOverrides,
      },
    ],
  };
}

// Achado B6 — descricaoLivre sobrepõe o nome genérico do catálogo no PDF
// quando preenchida; sem ela, continua mostrando o nome do catálogo (mesmo
// comportamento de sempre, zero regressão pra item já existente).
describe("mapearDadosPdf — nome do item (achado B6)", () => {
  it("sem descricaoLivre: usa o nome do catálogo", () => {
    const dados = mapearDadosPdf(orcamentoBase());
    expect(dados.itens[0].nome).toBe("Banner em Lona");
  });

  it("com descricaoLivre preenchida: usa a descrição específica, não o nome do catálogo", () => {
    const dados = mapearDadosPdf(
      orcamentoBase({ descricaoLivre: "Banner 3×1m lona 440g com bastão e corda" })
    );
    expect(dados.itens[0].nome).toBe("Banner 3×1m lona 440g com bastão e corda");
  });

  it("descricaoLivre só com espaços em branco: cai no nome do catálogo (trim vira vazio)", () => {
    const dados = mapearDadosPdf(orcamentoBase({ descricaoLivre: "   " }));
    expect(dados.itens[0].nome).toBe("Banner em Lona");
  });
});
