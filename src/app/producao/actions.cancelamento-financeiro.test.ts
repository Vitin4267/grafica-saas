import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.custo-auditoria.test.ts) — cobre o achado N2 da
// auditoria de código (auditoria-codigo-2026-09-02.md / Parte 8): cancelar
// pedido não desfazia ContaReceber nem Comissao, e o orçamento continuava
// contando como faturamento em buscarVisaoGeralNegocio mesmo depois do
// pedido cancelado.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock("@/lib/auth/session", () => ({
  exigirUsuarioAutenticado: vi.fn(),
}));
vi.mock("@/lib/auth/email-verificacao", () => ({
  exigirEmailVerificado: vi.fn(async () => {}),
}));
vi.mock("@/lib/auth/assinatura", () => ({
  exigirAssinaturaAtiva: vi.fn(async () => {}),
}));
vi.mock("@/lib/webhook-automacao", () => ({
  buscarAutomacaoGrafica: vi.fn(async () => ({ webhookUrl: null, notificarStatusMudou: false })),
  dispararEventoAutomacao: vi.fn(async () => {}),
}));

import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { cancelarPedido } from "./actions";
import { buscarVisaoGeralNegocio } from "@/lib/meu-negocio";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioId: string;
  orcamentoId: string;
  pedidoId: string;
  categoriaCustoId: string;
};

async function criarFixture(opts: { comValorFaturamento?: number } = {}): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Cancelamento Financeiro ${s}`, slug: `teste-cancel-financeiro-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-cancel-financeiro-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      comissaoPercent: 5,
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: cliente.id,
      usuarioId: usuario.id,
      status: "APROVADO",
      total: opts.comValorFaturamento ?? 1000,
    },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "ARTE" },
  });
  const categoriaCusto = await prisma.categoriaCusto.create({
    data: { graficaId: grafica.id, nome: `Categoria ${s}` },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioId: usuario.id,
    orcamentoId: orcamento.id,
    pedidoId: pedido.id,
    categoriaCustoId: categoriaCusto.id,
  };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.despesa.deleteMany({ where: { graficaId } });
    await prisma.comissao.deleteMany({ where: { graficaId } });
    await prisma.contaReceber.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("cancelarPedido desfaz financeiro (achado N2)", () => {
  it(
    "cancela ContaReceber PENDENTE e Comissao PENDENTE do orçamento, mas preserva conta PARCIAL",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const contaPendente = await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          descricao: "Parcela 1/1",
          valor: 1000,
          vencimento: new Date(),
          status: "PENDENTE",
        },
      });
      // Uma segunda conta, já com baixa parcial — não deve ser tocada, pois
      // já existe dinheiro real recebido nela.
      const contaParcial = await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          descricao: "Parcela extra",
          valor: 500,
          vencimento: new Date(),
          status: "PARCIAL",
        },
      });
      const comissao = await prisma.comissao.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          usuarioId: f.usuarioId,
          baseCalculo: "VALOR",
          percentualAplicado: 5,
          valorBase: 1000,
          valorComissao: 50,
          status: "PENDENTE",
        },
      });

      const resultado = await cancelarPedido(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const contaPendenteDepois = await prisma.contaReceber.findUniqueOrThrow({ where: { id: contaPendente.id } });
      expect(contaPendenteDepois.status).toBe("CANCELADO");

      const contaParcialDepois = await prisma.contaReceber.findUniqueOrThrow({ where: { id: contaParcial.id } });
      expect(contaParcialDepois.status).toBe("PARCIAL"); // não mexido — dinheiro real já entrou

      const comissaoDepois = await prisma.comissao.findUniqueOrThrow({ where: { id: comissao.id } });
      expect(comissaoDepois.status).toBe("CANCELADA");

      const logs = await prisma.logAuditoria.findMany({ where: { graficaId: f.graficaId } });
      expect(logs.some((l) => l.acao === "conta_receber.cancelar" && l.entidadeId === contaPendente.id)).toBe(true);
      expect(logs.some((l) => l.acao === "comissao.cancelar" && l.entidadeId === comissao.id)).toBe(true);
      // A conta parcial não gera log de cancelamento nenhum.
      expect(logs.some((l) => l.entidadeId === contaParcial.id)).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "não mexe em Comissao já PAGA nem gera log pra ela",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const comissaoPaga = await prisma.comissao.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          usuarioId: f.usuarioId,
          baseCalculo: "VALOR",
          percentualAplicado: 5,
          valorBase: 1000,
          valorComissao: 50,
          status: "PAGA",
          pagoEm: new Date(),
        },
      });

      const resultado = await cancelarPedido(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const comissaoDepois = await prisma.comissao.findUniqueOrThrow({ where: { id: comissaoPaga.id } });
      expect(comissaoDepois.status).toBe("PAGA"); // dinheiro já pago, não estorna sozinho

      const logs = await prisma.logAuditoria.findMany({ where: { graficaId: f.graficaId } });
      expect(logs.some((l) => l.acao === "comissao.cancelar")).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "orçamento de pedido cancelado sai do faturamento de buscarVisaoGeralNegocio",
    async () => {
      const f = await criarFixture({ comValorFaturamento: 12345 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const antes = await buscarVisaoGeralNegocio(f.graficaId);
      expect(antes.faturamentoMes.total).toBeGreaterThanOrEqual(12345);

      const resultado = await cancelarPedido(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const depois = await buscarVisaoGeralNegocio(f.graficaId);
      expect(depois.faturamentoMes.total).toBe(antes.faturamentoMes.total - 12345);
    },
    TIMEOUT_MS
  );
});

// Achado N22 da Parte 9 da auditoria de código (2026-09-12): cancelarPedido
// só estornava CustoPedido derivado de baixa de estoque — os espelhos
// origem=COMISSAO/DESPESA ficavam ativos pra sempre, inflando custosVariaveis
// da DRE sem receita correspondente. Decisão do dono: só reverte o que ainda
// não foi incorrido (Comissao/Despesa ainda PENDENTE — dinheiro que já saiu
// da gráfica não é estornado sozinho, mesmo critério já aplicado à Comissao).
describe("cancelarPedido estorna espelhos de CustoPedido (achado N22)", () => {
  it(
    "estorna o CustoPedido origem=COMISSAO junto com a Comissao PENDENTE",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      await prisma.comissao.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          usuarioId: f.usuarioId,
          baseCalculo: "VALOR",
          percentualAplicado: 5,
          valorBase: 1000,
          valorComissao: 50,
          status: "PENDENTE",
        },
      });
      const custoComissao = await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          categoriaCustoId: f.categoriaCustoId,
          origem: "COMISSAO",
          valor: 50,
        },
      });

      const resultado = await cancelarPedido(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const custoDepois = await prisma.custoPedido.findUniqueOrThrow({ where: { id: custoComissao.id } });
      expect(custoDepois.estornadoEm).not.toBeNull();

      const logs = await prisma.logAuditoria.findMany({ where: { graficaId: f.graficaId } });
      expect(logs.some((l) => l.acao === "custo_pedido.estornar" && l.entidadeId === custoComissao.id)).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "NÃO estorna o CustoPedido origem=COMISSAO quando a Comissao já está PAGA",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      await prisma.comissao.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: f.orcamentoId,
          usuarioId: f.usuarioId,
          baseCalculo: "VALOR",
          percentualAplicado: 5,
          valorBase: 1000,
          valorComissao: 50,
          status: "PAGA",
          pagoEm: new Date(),
        },
      });
      const custoComissao = await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          categoriaCustoId: f.categoriaCustoId,
          origem: "COMISSAO",
          valor: 50,
        },
      });

      const resultado = await cancelarPedido(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const custoDepois = await prisma.custoPedido.findUniqueOrThrow({ where: { id: custoComissao.id } });
      expect(custoDepois.estornadoEm).toBeNull(); // dinheiro já pago, não estorna sozinho
    },
    TIMEOUT_MS
  );

  it(
    "estorna o CustoPedido origem=DESPESA quando a Despesa vinculada ainda está PENDENTE",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const despesa = await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Frete terceirizado",
          categoriaCustoId: f.categoriaCustoId,
          valor: 200,
          vencimento: new Date(),
          status: "PENDENTE",
          pedidoId: f.pedidoId,
        },
      });
      const custoDespesa = await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          categoriaCustoId: f.categoriaCustoId,
          origem: "DESPESA",
          despesaId: despesa.id,
          valor: 200,
        },
      });

      const resultado = await cancelarPedido(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const custoDepois = await prisma.custoPedido.findUniqueOrThrow({ where: { id: custoDespesa.id } });
      expect(custoDepois.estornadoEm).not.toBeNull();

      // A Despesa em si (contas a pagar) não é tocada — só o espelho sai da
      // conta de lucro/DRE do pedido cancelado.
      const despesaDepois = await prisma.despesa.findUniqueOrThrow({ where: { id: despesa.id } });
      expect(despesaDepois.status).toBe("PENDENTE");
    },
    TIMEOUT_MS
  );

  it(
    "NÃO estorna o CustoPedido origem=DESPESA quando a Despesa vinculada já está PAGA",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const despesa = await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Frete já pago",
          categoriaCustoId: f.categoriaCustoId,
          valor: 200,
          vencimento: new Date(),
          status: "PAGA",
          pagoEm: new Date(),
          pedidoId: f.pedidoId,
        },
      });
      const custoDespesa = await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          categoriaCustoId: f.categoriaCustoId,
          origem: "DESPESA",
          despesaId: despesa.id,
          valor: 200,
        },
      });

      const resultado = await cancelarPedido(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const custoDepois = await prisma.custoPedido.findUniqueOrThrow({ where: { id: custoDespesa.id } });
      expect(custoDepois.estornadoEm).toBeNull(); // dinheiro já pago, não estorna sozinho
    },
    TIMEOUT_MS
  );

  it(
    "NÃO estorna CustoPedido origem=COMPRA (já incorrido por construção — nasce só ao RECEBER a compra)",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const custoCompra = await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          categoriaCustoId: f.categoriaCustoId,
          origem: "COMPRA",
          valor: 300,
        },
      });

      const resultado = await cancelarPedido(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const custoDepois = await prisma.custoPedido.findUniqueOrThrow({ where: { id: custoCompra.id } });
      expect(custoDepois.estornadoEm).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "NÃO estorna CustoPedido origem=TERCEIRIZACAO (já incorrido por construção — nasce só quando valorFinal é preenchido)",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const custoTerceirizacao = await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          categoriaCustoId: f.categoriaCustoId,
          origem: "TERCEIRIZACAO",
          valor: 400,
        },
      });

      const resultado = await cancelarPedido(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const custoDepois = await prisma.custoPedido.findUniqueOrThrow({ where: { id: custoTerceirizacao.id } });
      expect(custoDepois.estornadoEm).toBeNull();
    },
    TIMEOUT_MS
  );
});
