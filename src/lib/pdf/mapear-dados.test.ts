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
      chavePix: null,
      tipoChavePix: null,
      favorecidoPix: null,
      dadosBancarios: null,
      parametros: { termosCondicoesPdf: null, mostrarEspecificacoesTecnicas: true, prazoEmDiasUteis: true, toleranciaTiragemPercent: 0 as unknown as Prisma.Decimal },
    },
    vendedor: null,
    tipoPedido: null,
    condicoesPagamento: null,
    frete: null,
    transportadora: null,
    localEntrega: null,
    notaEmpenho: null,
    processoLicitatorio: null,
    prazoEntregaEstimadoDias: null,
    itens: [
      {
        quantidade: 100,
        larguraCm: null,
        alturaCm: null,
        profundidadeCm: null,
        espessuraMm: null,
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
        faixasQuantidade: [],
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

// Achado A2 da Parte 6 (auditoria de abrangência, 2026-08-27) — o rótulo do
// prazo estimado no PDF ("dias úteis" vs "dias corridos") passa a vir de
// ParametrosGrafica.prazoEmDiasUteis, não mais fixo em código.
describe("mapearDadosPdf — dias úteis vs corridos (achado A2 da Parte 6)", () => {
  it("prazoEmDiasUteis true (ou gráfica sem ParametrosGrafica): flag sai true", () => {
    const dados = mapearDadosPdf(orcamentoBase());
    expect(dados.prazoEmDiasUteis).toBe(true);
  });

  it("prazoEmDiasUteis false: flag sai false", () => {
    const base = orcamentoBase();
    const dados = mapearDadosPdf({
      ...base,
      grafica: {
        ...base.grafica,
        parametros: { termosCondicoesPdf: null, mostrarEspecificacoesTecnicas: true, prazoEmDiasUteis: false, toleranciaTiragemPercent: 0 as unknown as Prisma.Decimal },
      },
    });
    expect(dados.prazoEmDiasUteis).toBe(false);
  });
});

// Achado F6 da Parte 7 (auditoria de abrangência, 2026-08-31) — dados de
// recebimento (PIX) da gráfica só aparecem no PDF quando cadastrados; sem
// nada preenchido, o mapeamento sai null (mesmo comportamento de hoje pra
// toda gráfica que nunca configurou, sem regressão).
describe("mapearDadosPdf — dados de recebimento / PIX (achado F6)", () => {
  it("sem nenhum campo de pagamento cadastrado: sai tudo null", () => {
    const dados = mapearDadosPdf(orcamentoBase());
    expect(dados.chavePix).toBeNull();
    expect(dados.tipoChavePix).toBeNull();
    expect(dados.favorecidoPix).toBeNull();
    expect(dados.dadosBancarios).toBeNull();
  });

  it("com chavePix e tipoChavePix cadastrados: sai a chave e o tipo já convertido pro rótulo em português", () => {
    const base = orcamentoBase();
    const dados = mapearDadosPdf({
      ...base,
      grafica: {
        ...base.grafica,
        chavePix: "contato@grafica.com.br",
        tipoChavePix: "EMAIL",
      },
    });
    expect(dados.chavePix).toBe("contato@grafica.com.br");
    expect(dados.tipoChavePix).toBe("E-mail");
  });

  it("com favorecidoPix e dadosBancarios cadastrados, sem chavePix: cada campo sai independente", () => {
    const base = orcamentoBase();
    const dados = mapearDadosPdf({
      ...base,
      grafica: {
        ...base.grafica,
        favorecidoPix: "João da Silva",
        dadosBancarios: "Banco X, ag. 0001, c/c 12345-6",
      },
    });
    expect(dados.chavePix).toBeNull();
    expect(dados.favorecidoPix).toBe("João da Silva");
    expect(dados.dadosBancarios).toBe("Banco X, ag. 0001, c/c 12345-6");
  });
});
