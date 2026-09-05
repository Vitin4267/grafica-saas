import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { buscarDRE } from "@/lib/dre-query";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de meu-negocio.test.ts) — cobre o achado A3 da Parte 4 da
// auditoria de abrangência (pesquisa-abrangencia-modulos.md, 2026-09-05):
// DRE simplificado com separação de custo variável/fixo (achado A2,
// CategoriaCusto.natureza) e cada linha rotulada com regime explícito.

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Janela de 1 dia (hoje) — cada teste cria dados com createdAt/pagoEm dentro
// desta janela e verifica que buscarDRE(inicio, fim) só enxerga o que está
// dentro dela.
function janelaHoje(): { inicio: Date; fim: Date } {
  const inicio = new Date();
  inicio.setUTCHours(0, 0, 0, 0);
  const fim = new Date(inicio);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return { inicio, fim };
}

// Fora da janela de propósito — usado pra provar que o filtro de período
// exclui o que não deveria contar.
const FORA_DA_JANELA = new Date("2020-01-01T00:00:00Z");

const graficaIdsParaLimpar: string[] = [];

async function criarFixtureBase() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste DRE ${s}`, slug: `teste-dre-${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-dre-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id },
  });
  const categoriaVariavel = await prisma.categoriaCusto.create({
    data: { graficaId: grafica.id, nome: `Papel ${s}`, natureza: "VARIAVEL" },
  });
  const categoriaFixa = await prisma.categoriaCusto.create({
    data: { graficaId: grafica.id, nome: `Aluguel ${s}`, natureza: "FIXO" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioId: dono.id,
    clienteId: cliente.id,
    itemGraficaId: itemGrafica.id,
    categoriaVariavelId: categoriaVariavel.id,
    categoriaFixaId: categoriaFixa.id,
    s,
  };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.comissao.deleteMany({ where: { graficaId } });
    await prisma.despesa.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("buscarDRE — achado A3 da Parte 4", () => {
  it(
    "monta o DRE completo com caso concreto: receita, desconto, imposto, custo variável, custo fixo e comissão",
    async () => {
      const f = await criarFixtureBase();
      const { inicio, fim } = janelaHoje();

      await prisma.parametrosGrafica.create({
        data: { graficaId: f.graficaId, impostoPercent: 0.05 },
      });

      const orcamento = await prisma.orcamento.create({
        data: {
          graficaId: f.graficaId,
          clienteId: f.clienteId,
          usuarioId: f.usuarioId,
          status: "APROVADO",
          total: 10_000,
        },
      });
      // Item com desconto concedido: sugerido 1.200 (10 × 120), negociado
      // 1.000 (10 × 100) — desconto de 200.
      await prisma.orcamentoItem.create({
        data: {
          orcamentoId: orcamento.id,
          itemGraficaId: f.itemGraficaId,
          quantidade: 10,
          precoUnitario: 100,
          precoTotal: 1000,
          precoSugeridoUnitario: 120,
        },
      });
      const pedido = await prisma.pedido.create({
        data: { graficaId: f.graficaId, orcamentoId: orcamento.id, status: "ARTE" },
      });

      await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: pedido.id,
          categoriaCustoId: f.categoriaVariavelId,
          valor: 3000,
          origem: "MANUAL",
        },
      });

      await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Aluguel do mês",
          categoriaCustoId: f.categoriaFixaId,
          valor: 1500,
          vencimento: new Date("2026-01-01T00:00:00Z"),
          status: "PAGA",
          pagoEm: new Date(),
        },
      });

      await prisma.comissao.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: orcamento.id,
          usuarioId: f.usuarioId,
          baseCalculo: "VALOR",
          percentualAplicado: 3,
          valorBase: 10_000,
          valorComissao: 300,
          status: "PAGA",
          pagoEm: new Date(),
        },
      });

      const dre = await buscarDRE(f.graficaId, inicio, fim);

      expect(dre.linhas.find((l) => l.rotulo === "Receita bruta")?.valor).toBe(10_000);
      expect(dre.linhas.find((l) => l.rotulo === "(−) Descontos")?.valor).toBe(-200);
      expect(dre.linhas.find((l) => l.rotulo === "(−) Impostos (estimado)")?.valor).toBe(-500); // 5% de 10.000
      expect(dre.receitaLiquida).toBe(9_300); // 10.000 - 500 - 200
      expect(dre.linhas.find((l) => l.rotulo === "(−) Custos variáveis")?.valor).toBe(-3_000);
      expect(dre.margemContribuicao).toBe(6_300); // 9.300 - 3.000
      expect(dre.margemContribuicaoPercent).toBeCloseTo(6_300 / 9_300, 10);
      expect(dre.linhas.find((l) => l.rotulo === "(−) Custo fixo (pago)")?.valor).toBe(-1_500);
      expect(dre.linhas.find((l) => l.rotulo === "(−) Comissões (pagas)")?.valor).toBe(-300);
      expect(dre.resultadoOperacional).toBe(4_500); // 6.300 - 1.500 - 300
      expect(dre.resultadoLiquido).toBe(4_500); // sem despesa financeira
      expect(dre.pontoEquilibrio).toBeCloseTo(1_500 / (6_300 / 9_300), 6);
    },
    TIMEOUT_MS
  );

  it(
    "exclui receita de orçamento aprovado cujo Pedido foi CANCELADO (achado N2)",
    async () => {
      const f = await criarFixtureBase();
      const { inicio, fim } = janelaHoje();

      const orcamentoCancelado = await prisma.orcamento.create({
        data: {
          graficaId: f.graficaId,
          clienteId: f.clienteId,
          usuarioId: f.usuarioId,
          status: "APROVADO",
          total: 5_000,
        },
      });
      await prisma.pedido.create({
        data: { graficaId: f.graficaId, orcamentoId: orcamentoCancelado.id, status: "CANCELADO" },
      });

      const dre = await buscarDRE(f.graficaId, inicio, fim);

      expect(dre.linhas.find((l) => l.rotulo === "Receita bruta")?.valor).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    "exclui CustoPedido estornado do custo variável",
    async () => {
      const f = await criarFixtureBase();
      const { inicio, fim } = janelaHoje();

      const orcamento = await prisma.orcamento.create({
        data: {
          graficaId: f.graficaId,
          clienteId: f.clienteId,
          usuarioId: f.usuarioId,
          status: "APROVADO",
          total: 1_000,
        },
      });
      const pedido = await prisma.pedido.create({
        data: { graficaId: f.graficaId, orcamentoId: orcamento.id, status: "ARTE" },
      });

      await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: pedido.id,
          categoriaCustoId: f.categoriaVariavelId,
          valor: 300,
          origem: "MANUAL",
          estornadoEm: new Date(),
        },
      });
      await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: pedido.id,
          categoriaCustoId: f.categoriaVariavelId,
          valor: 100,
          origem: "MANUAL",
        },
      });

      const dre = await buscarDRE(f.graficaId, inicio, fim);

      // Só o custo NÃO estornado (100) entra — o estornado (300) fica de fora.
      expect(dre.linhas.find((l) => l.rotulo === "(−) Custos variáveis")?.valor).toBe(-100);
    },
    TIMEOUT_MS
  );

  it(
    "não conta Despesa FIXO ainda PENDENTE (só Despesa PAGA vira custo fixo do DRE)",
    async () => {
      const f = await criarFixtureBase();
      const { inicio, fim } = janelaHoje();

      await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Aluguel pendente",
          categoriaCustoId: f.categoriaFixaId,
          valor: 2_000,
          vencimento: new Date("2026-01-01T00:00:00Z"),
          status: "PENDENTE",
        },
      });

      const dre = await buscarDRE(f.graficaId, inicio, fim);

      expect(dre.linhas.find((l) => l.rotulo === "(−) Custo fixo (pago)")?.valor).toBe(-0);
    },
    TIMEOUT_MS
  );

  it(
    "não conta Despesa FIXO paga FORA do período (fronteira de data respeitada)",
    async () => {
      const f = await criarFixtureBase();
      const { inicio, fim } = janelaHoje();

      await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Aluguel pago ano passado",
          categoriaCustoId: f.categoriaFixaId,
          valor: 2_000,
          vencimento: new Date("2020-01-01T00:00:00Z"),
          status: "PAGA",
          pagoEm: FORA_DA_JANELA,
        },
      });

      const dre = await buscarDRE(f.graficaId, inicio, fim);

      expect(dre.linhas.find((l) => l.rotulo === "(−) Custo fixo (pago)")?.valor).toBe(-0);
    },
    TIMEOUT_MS
  );

  it(
    "isola por gráfica: dados de outro tenant nunca entram no DRE desta gráfica",
    async () => {
      const f = await criarFixtureBase();
      const outraFixture = await criarFixtureBase();
      const { inicio, fim } = janelaHoje();

      await prisma.orcamento.create({
        data: {
          graficaId: outraFixture.graficaId,
          clienteId: outraFixture.clienteId,
          usuarioId: outraFixture.usuarioId,
          status: "APROVADO",
          total: 99_999,
        },
      });

      const dre = await buscarDRE(f.graficaId, inicio, fim);

      expect(dre.linhas.find((l) => l.rotulo === "Receita bruta")?.valor).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    "gráfica sem ParametrosGrafica configurado não trava — imposto vira 0, não default de 6%",
    async () => {
      const f = await criarFixtureBase(); // não cria ParametrosGrafica de propósito
      const { inicio, fim } = janelaHoje();

      await prisma.orcamento.create({
        data: {
          graficaId: f.graficaId,
          clienteId: f.clienteId,
          usuarioId: f.usuarioId,
          status: "APROVADO",
          total: 1_000,
        },
      });

      const dre = await buscarDRE(f.graficaId, inicio, fim);

      expect(dre.linhas.find((l) => l.rotulo === "(−) Impostos (estimado)")?.valor).toBe(-0);
    },
    TIMEOUT_MS
  );
});
