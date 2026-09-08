import { describe, it, expect } from "vitest";
import {
  calcularAging,
  agruparPorCategoriaComNatureza,
  detectarCandidatosDuplicidade,
  type LancamentoCategorizado,
  type PagamentoParaDuplicidade,
} from "@/lib/exportacao-financeira";

// Teste UNITÁRIO (funções puras, sem banco) — achado A16 da Parte 4 da
// auditoria de abrangência (pesquisa-abrangencia-modulos.md, 2026-09-07).

function diaUTC(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

describe("calcularAging", () => {
  it("vencimento no futuro (ou hoje) fica EM_DIA, sem dias de atraso negativos escondidos", () => {
    const hoje = diaUTC("2026-09-07");
    expect(calcularAging(diaUTC("2026-09-07"), hoje)).toEqual({ diasAtraso: 0, faixa: "EM_DIA" });
    expect(calcularAging(diaUTC("2026-09-20"), hoje)).toEqual({ diasAtraso: -13, faixa: "EM_DIA" });
  });

  it("classifica nas faixas 1-30/31-60/61-90/90+ pela borda exata", () => {
    const hoje = diaUTC("2026-09-07");
    expect(calcularAging(diaUTC("2026-08-08"), hoje)).toEqual({ diasAtraso: 30, faixa: "1_30" }); // exatamente 30
    expect(calcularAging(diaUTC("2026-08-07"), hoje)).toEqual({ diasAtraso: 31, faixa: "31_60" }); // 31
    expect(calcularAging(diaUTC("2026-07-09"), hoje)).toEqual({ diasAtraso: 60, faixa: "31_60" });
    expect(calcularAging(diaUTC("2026-07-08"), hoje)).toEqual({ diasAtraso: 61, faixa: "61_90" });
    expect(calcularAging(diaUTC("2026-06-09"), hoje)).toEqual({ diasAtraso: 90, faixa: "61_90" });
    expect(calcularAging(diaUTC("2026-06-08"), hoje)).toEqual({ diasAtraso: 91, faixa: "90_MAIS" });
  });
});

describe("agruparPorCategoriaComNatureza", () => {
  it("soma lançamentos da mesma categoria e calcula subtotal por natureza", () => {
    const lancamentos: LancamentoCategorizado[] = [
      { categoriaId: "papel", categoriaNome: "Papel", natureza: "VARIAVEL", valor: 100 },
      { categoriaId: "papel", categoriaNome: "Papel", natureza: "VARIAVEL", valor: 50 },
      { categoriaId: "aluguel", categoriaNome: "Aluguel", natureza: "FIXO", valor: 2000 },
      { categoriaId: "internet", categoriaNome: "Internet", natureza: "SEMIVARIAVEL", valor: 150 },
    ];

    const resultado = agruparPorCategoriaComNatureza(lancamentos);

    expect(resultado.categorias).toHaveLength(3);
    const papel = resultado.categorias.find((c) => c.categoriaId === "papel")!;
    expect(papel.total.toNumber()).toBe(150);

    const naturezaVariavel = resultado.naturezas.find((n) => n.natureza === "VARIAVEL")!;
    expect(naturezaVariavel.total.toNumber()).toBe(150);
    const naturezaFixo = resultado.naturezas.find((n) => n.natureza === "FIXO")!;
    expect(naturezaFixo.total.toNumber()).toBe(2000);
    const naturezaSemivariavel = resultado.naturezas.find((n) => n.natureza === "SEMIVARIAVEL")!;
    expect(naturezaSemivariavel.total.toNumber()).toBe(150);

    expect(resultado.totalGeral.toNumber()).toBe(2300);
  });

  it("categorias vêm ordenadas por nome (pt-BR) — determinístico", () => {
    const lancamentos: LancamentoCategorizado[] = [
      { categoriaId: "z", categoriaNome: "Zebra", natureza: "VARIAVEL", valor: 1 },
      { categoriaId: "a", categoriaNome: "Aluguel", natureza: "FIXO", valor: 1 },
    ];
    const resultado = agruparPorCategoriaComNatureza(lancamentos);
    expect(resultado.categorias.map((c) => c.categoriaNome)).toEqual(["Aluguel", "Zebra"]);
  });

  it("sem lançamentos, devolve zero em tudo (não quebra numa gráfica sem dado no período)", () => {
    const resultado = agruparPorCategoriaComNatureza([]);
    expect(resultado.categorias).toEqual([]);
    expect(resultado.naturezas).toEqual([]);
    expect(resultado.totalGeral.toNumber()).toBe(0);
  });
});

describe("detectarCandidatosDuplicidade — achado A16", () => {
  it("caso concreto: 2 pagamentos pro mesmo orçamento somam MAIS que o total dele — candidato", () => {
    const pagamentos: PagamentoParaDuplicidade[] = [
      {
        pagamentoId: "p1",
        orcamentoId: "orc1",
        orcamentoTotal: 1000,
        clienteNome: "Cliente A",
        valor: 1000, // pagamento manual na tela do orçamento
        financiaCreditoCliente: false,
      },
      {
        pagamentoId: "p2",
        orcamentoId: "orc1",
        orcamentoTotal: 1000,
        clienteNome: "Cliente A",
        valor: 1000, // registrarBaixaContaReceber gerou outro Pagamento pro MESMO dinheiro
        financiaCreditoCliente: false,
      },
    ];

    const candidatos = detectarCandidatosDuplicidade(pagamentos);

    expect(candidatos).toHaveLength(1);
    expect(candidatos[0].orcamentoId).toBe("orc1");
    expect(candidatos[0].totalPago.toNumber()).toBe(2000);
    expect(candidatos[0].totalOrcamento.toNumber()).toBe(1000);
    expect(candidatos[0].diferenca.toNumber()).toBe(1000);
    expect(candidatos[0].quantidadePagamentos).toBe(2);
  });

  it("1 pagamento só nunca é candidato, mesmo pagando a mais (caso legítimo isolado)", () => {
    const pagamentos: PagamentoParaDuplicidade[] = [
      {
        pagamentoId: "p1",
        orcamentoId: "orc1",
        orcamentoTotal: 1000,
        clienteNome: "Cliente A",
        valor: 1200,
        financiaCreditoCliente: false,
      },
    ];
    expect(detectarCandidatosDuplicidade(pagamentos)).toEqual([]);
  });

  it("pagamento que financiou depósito de CreditoCliente é excluído da soma (overpayment legítimo)", () => {
    const pagamentos: PagamentoParaDuplicidade[] = [
      {
        pagamentoId: "p1",
        orcamentoId: "orc1",
        orcamentoTotal: 1000,
        clienteNome: "Cliente A",
        valor: 1000,
        financiaCreditoCliente: false,
      },
      {
        pagamentoId: "p2",
        orcamentoId: "orc1",
        orcamentoTotal: 1000,
        clienteNome: "Cliente A",
        valor: 500, // sobra virou saldo de crédito do cliente, não é duplicidade
        financiaCreditoCliente: true,
      },
    ];
    expect(detectarCandidatosDuplicidade(pagamentos)).toEqual([]);
  });

  it("2 pagamentos que somam exatamente o total (parcelamento normal) não é candidato", () => {
    const pagamentos: PagamentoParaDuplicidade[] = [
      {
        pagamentoId: "p1",
        orcamentoId: "orc1",
        orcamentoTotal: 1000,
        clienteNome: "Cliente A",
        valor: 400,
        financiaCreditoCliente: false,
      },
      {
        pagamentoId: "p2",
        orcamentoId: "orc1",
        orcamentoTotal: 1000,
        clienteNome: "Cliente A",
        valor: 600,
        financiaCreditoCliente: false,
      },
    ];
    expect(detectarCandidatosDuplicidade(pagamentos)).toEqual([]);
  });

  it("orçamentos diferentes não se misturam, e o mais divergente aparece primeiro", () => {
    const pagamentos: PagamentoParaDuplicidade[] = [
      { pagamentoId: "p1", orcamentoId: "orcA", orcamentoTotal: 1000, clienteNome: "A", valor: 1000, financiaCreditoCliente: false },
      { pagamentoId: "p2", orcamentoId: "orcA", orcamentoTotal: 1000, clienteNome: "A", valor: 100, financiaCreditoCliente: false }, // diferença pequena: 100
      { pagamentoId: "p3", orcamentoId: "orcB", orcamentoTotal: 500, clienteNome: "B", valor: 500, financiaCreditoCliente: false },
      { pagamentoId: "p4", orcamentoId: "orcB", orcamentoTotal: 500, clienteNome: "B", valor: 500, financiaCreditoCliente: false }, // diferença grande: 500
    ];

    const candidatos = detectarCandidatosDuplicidade(pagamentos);

    expect(candidatos).toHaveLength(2);
    expect(candidatos[0].orcamentoId).toBe("orcB"); // maior diferença primeiro
    expect(candidatos[1].orcamentoId).toBe("orcA");
  });
});
