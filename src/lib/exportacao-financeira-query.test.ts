import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { buscarDadosExportacaoFinanceira, type PeriodoExportacao } from "@/lib/exportacao-financeira-query";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de dre-query.test.ts/meu-negocio.test.ts) — cobre o achado
// A16 da Parte 4 da auditoria de abrangência (pesquisa-abrangencia-
// modulos.md, 2026-09-07): exportação financeira com intervalo livre de
// datas, blocos novos (contas a receber com aging, comissões, custos por
// pedido, agrupamento por categoria/natureza, DRE) e possíveis
// duplicidades de recebimento.

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Janela de HOJE (dia corrente em UTC) — cada teste cria dados com
// createdAt/pagoEm/vencimento dentro desta janela.
function periodoHoje(): PeriodoExportacao {
  const inicio = new Date();
  inicio.setUTCHours(0, 0, 0, 0);
  const fim = new Date(inicio);
  fim.setUTCDate(fim.getUTCDate() + 1);
  return { inicioReal: inicio, fimReal: fim, inicioLiteral: inicio, fimLiteral: fim };
}

const FORA_DA_JANELA = new Date("2020-01-01T00:00:00Z");

const graficaIdsParaLimpar: string[] = [];

async function criarFixtureBase() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Exportação ${s}`, slug: `teste-exportacao-${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-exp-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const filial = await prisma.filial.create({
    data: { graficaId: grafica.id, nome: `Filial ${s}` },
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
    filialId: filial.id,
    itemGraficaId: itemGrafica.id,
    categoriaVariavelId: categoriaVariavel.id,
    categoriaFixaId: categoriaFixa.id,
    s,
  };
}

async function criarOrcamentoAprovado(
  f: Awaited<ReturnType<typeof criarFixtureBase>>,
  total: number,
  comFilial = false
) {
  return prisma.orcamento.create({
    data: {
      graficaId: f.graficaId,
      clienteId: f.clienteId,
      usuarioId: f.usuarioId,
      filialId: comFilial ? f.filialId : undefined,
      status: "APROVADO",
      total,
    },
  });
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.baixaContaReceber.deleteMany({ where: { pagamento: { orcamento: { graficaId } } } });
    await prisma.movimentacaoCreditoCliente.deleteMany({ where: { creditoCliente: { cliente: { graficaId } } } });
    await prisma.creditoCliente.deleteMany({ where: { cliente: { graficaId } } });
    await prisma.contaReceber.deleteMany({ where: { graficaId } });
    await prisma.pagamento.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.comissao.deleteMany({ where: { graficaId } });
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.despesa.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.filial.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("buscarDadosExportacaoFinanceira — achado A16 da Parte 4", () => {
  it(
    "monta os blocos novos com dado correto: contas a receber com aging, comissões, custos por pedido, filial",
    async () => {
      const f = await criarFixtureBase();
      const periodo = periodoHoje();

      const orcamento = await criarOrcamentoAprovado(f, 5_000, true);
      const pedido = await prisma.pedido.create({
        data: { graficaId: f.graficaId, orcamentoId: orcamento.id, status: "ARTE" },
      });

      // Conta a receber VENCIDA há 10 dias — deve aparecer com aging 1_30.
      const vencimentoAtrasado = new Date();
      vencimentoAtrasado.setUTCHours(0, 0, 0, 0);
      vencimentoAtrasado.setUTCDate(vencimentoAtrasado.getUTCDate() - 10);
      await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: orcamento.id,
          clienteId: f.clienteId,
          descricao: "Parcela 1/1",
          valor: 5_000,
          vencimento: vencimentoAtrasado,
          status: "PENDENTE",
        },
      });

      await prisma.comissao.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: orcamento.id,
          usuarioId: f.usuarioId,
          baseCalculo: "VALOR",
          percentualAplicado: 5,
          valorBase: 5_000,
          valorComissao: 250,
          status: "PAGA",
          pagoEm: new Date(),
        },
      });

      await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: pedido.id,
          categoriaCustoId: f.categoriaVariavelId,
          valor: 800,
          origem: "MANUAL",
        },
      });
      await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: pedido.id,
          categoriaCustoId: f.categoriaVariavelId,
          valor: 200,
          origem: "MANUAL",
        },
      });

      const dados = await buscarDadosExportacaoFinanceira(f.graficaId, periodo);

      expect(dados.contasAReceber).toHaveLength(1);
      expect(dados.contasAReceber[0].diasAtraso).toBe(10);
      expect(dados.contasAReceber[0].faixaAging).toBe("1_30");
      expect(dados.contasAReceber[0].filialNome).toBe(`Filial ${f.s}`);
      expect(dados.contasAReceber[0].saldo.toNumber()).toBe(5_000);

      expect(dados.comissoes).toHaveLength(1);
      expect(dados.comissoes[0].valorComissao.toNumber()).toBe(250);
      expect(dados.comissoes[0].filialNome).toBe(`Filial ${f.s}`);

      expect(dados.custosPorPedido).toHaveLength(1);
      expect(dados.custosPorPedido[0].total.toNumber()).toBe(1_000); // 800 + 200 no mesmo pedido
      expect(dados.custosPorPedido[0].quantidadeLancamentos).toBe(2);
      expect(dados.custosPorPedido[0].filialNome).toBe(`Filial ${f.s}`);

      // O agrupamento por categoria enxerga o custo de pedido lançado.
      const papel = dados.agrupamentoCategoria.categorias.find((c) => c.categoriaId === f.categoriaVariavelId);
      expect(papel?.total.toNumber()).toBe(1_000);
      expect(papel?.natureza).toBe("VARIAVEL");
    },
    TIMEOUT_MS
  );

  it(
    "aging inclui conta vencida ANTES do início do período (relatório de aging não se limita à janela), mas exclui vencimento FUTURO (depois do fim)",
    async () => {
      const f = await criarFixtureBase();
      const periodo = periodoHoje();

      const orcamentoAntiga = await criarOrcamentoAprovado(f, 1_000);
      await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: orcamentoAntiga.id,
          clienteId: f.clienteId,
          descricao: "Vencida há muito tempo",
          valor: 1_000,
          vencimento: FORA_DA_JANELA, // 2020 — bem antes do período "hoje"
          status: "PENDENTE",
        },
      });

      const orcamentoFutura = await criarOrcamentoAprovado(f, 2_000);
      const vencimentoFuturo = new Date();
      vencimentoFuturo.setUTCHours(0, 0, 0, 0);
      vencimentoFuturo.setUTCDate(vencimentoFuturo.getUTCDate() + 30);
      await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: orcamentoFutura.id,
          clienteId: f.clienteId,
          descricao: "Vence daqui 30 dias",
          valor: 2_000,
          vencimento: vencimentoFuturo,
          status: "PENDENTE",
        },
      });

      const dados = await buscarDadosExportacaoFinanceira(f.graficaId, periodo);

      expect(dados.contasAReceber).toHaveLength(1);
      expect(dados.contasAReceber[0].descricao).toBe("Vencida há muito tempo");
      expect(dados.contasAReceber[0].faixaAging).toBe("90_MAIS");
    },
    TIMEOUT_MS
  );

  it(
    "conta a receber com saldo PARCIAL exporta o saldo em aberto, não o valor cheio",
    async () => {
      const f = await criarFixtureBase();
      const periodo = periodoHoje();

      const orcamento = await criarOrcamentoAprovado(f, 1_000);
      const vencimentoHoje = new Date();
      vencimentoHoje.setUTCHours(0, 0, 0, 0);
      const conta = await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: orcamento.id,
          clienteId: f.clienteId,
          descricao: "Parcela única",
          valor: 1_000,
          vencimento: vencimentoHoje,
          status: "PARCIAL",
        },
      });
      const pagamentoBaixa = await prisma.pagamento.create({
        data: { orcamentoId: orcamento.id, valor: 400, forma: "PIX" },
      });
      await prisma.baixaContaReceber.create({
        data: { contaReceberId: conta.id, pagamentoId: pagamentoBaixa.id, valor: 400 },
      });

      const dados = await buscarDadosExportacaoFinanceira(f.graficaId, periodo);

      expect(dados.contasAReceber).toHaveLength(1);
      expect(dados.contasAReceber[0].saldo.toNumber()).toBe(600); // 1000 - 400 já baixado
      expect(dados.contasAReceber[0].status).toBe("PARCIAL");
    },
    TIMEOUT_MS
  );

  it(
    "conta a receber com status EM_COBRANCA (marcada em cobrança após baixa parcial) exporta o saldo em aberto, não o valor cheio",
    async () => {
      const f = await criarFixtureBase();
      const periodo = periodoHoje();

      const orcamento = await criarOrcamentoAprovado(f, 10_000);
      const vencimentoHoje = new Date();
      vencimentoHoje.setUTCHours(0, 0, 0, 0);
      const conta = await prisma.contaReceber.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: orcamento.id,
          clienteId: f.clienteId,
          descricao: "Parcela em cobrança",
          valor: 10_000,
          vencimento: vencimentoHoje,
          status: "EM_COBRANCA",
        },
      });
      // Simula que R$ 7.000 já foram recebidos (baixa anterior)
      const pagamentoBaixa = await prisma.pagamento.create({
        data: { orcamentoId: orcamento.id, valor: 7_000, forma: "PIX" },
      });
      await prisma.baixaContaReceber.create({
        data: { contaReceberId: conta.id, pagamentoId: pagamentoBaixa.id, valor: 7_000 },
      });

      const dados = await buscarDadosExportacaoFinanceira(f.graficaId, periodo);

      expect(dados.contasAReceber).toHaveLength(1);
      expect(dados.contasAReceber[0].saldo.toNumber()).toBe(3_000); // 10000 - 7000 já baixado, NÃO 10000
      expect(dados.contasAReceber[0].status).toBe("EM_COBRANCA");
    },
    TIMEOUT_MS
  );

  it(
    "detecta candidato a duplicidade: Pagamento manual + baixa de ContaReceber pro mesmo orçamento somam mais que o total",
    async () => {
      const f = await criarFixtureBase();
      const periodo = periodoHoje();

      const orcamento = await criarOrcamentoAprovado(f, 1_000);

      // Pagamento manual solto (não reconciliado com nenhuma ContaReceber —
      // valor não bate exato com nenhuma pendente).
      await prisma.pagamento.create({
        data: { orcamentoId: orcamento.id, valor: 1_000, forma: "PIX" },
      });

      // Depois, alguém também registra baixa da ContaReceber pro MESMO
      // dinheiro — gera um SEGUNDO Pagamento (mesmo mecanismo de
      // registrarBaixaContaReceber).
      await prisma.pagamento.create({
        data: { orcamentoId: orcamento.id, valor: 1_000, forma: "PIX", observacao: "Gerado ao registrar baixa" },
      });

      const dados = await buscarDadosExportacaoFinanceira(f.graficaId, periodo);

      expect(dados.candidatosDuplicidade).toHaveLength(1);
      expect(dados.candidatosDuplicidade[0].orcamentoId).toBe(orcamento.id);
      expect(dados.candidatosDuplicidade[0].totalPago.toNumber()).toBe(2_000);
      expect(dados.candidatosDuplicidade[0].totalOrcamento.toNumber()).toBe(1_000);
      expect(dados.candidatosDuplicidade[0].diferenca.toNumber()).toBe(1_000);
    },
    TIMEOUT_MS
  );

  it(
    "NÃO marca como duplicidade quando a sobra financiou um depósito de CreditoCliente (overpayment legítimo)",
    async () => {
      const f = await criarFixtureBase();
      const periodo = periodoHoje();

      const orcamento = await criarOrcamentoAprovado(f, 1_000);

      const pagamentoNormal = await prisma.pagamento.create({
        data: { orcamentoId: orcamento.id, valor: 1_000, forma: "PIX" },
      });
      const pagamentoExtra = await prisma.pagamento.create({
        data: { orcamentoId: orcamento.id, valor: 300, forma: "PIX" },
      });
      const creditoCliente = await prisma.creditoCliente.create({
        data: { clienteId: f.clienteId },
      });
      await prisma.movimentacaoCreditoCliente.create({
        data: {
          creditoClienteId: creditoCliente.id,
          tipo: "DEPOSITO",
          valor: 300,
          pagamentoId: pagamentoExtra.id,
        },
      });
      void pagamentoNormal;

      const dados = await buscarDadosExportacaoFinanceira(f.graficaId, periodo);

      expect(dados.candidatosDuplicidade).toEqual([]);
    },
    TIMEOUT_MS
  );

  it(
    "respeita o intervalo livre de datas: dado fora do período não entra em nenhum bloco",
    async () => {
      const f = await criarFixtureBase();
      const periodo = periodoHoje();

      const orcamento = await criarOrcamentoAprovado(f, 1_000);
      const pedido = await prisma.pedido.create({
        data: { graficaId: f.graficaId, orcamentoId: orcamento.id, status: "ARTE" },
      });

      await prisma.pagamento.create({
        data: { orcamentoId: orcamento.id, valor: 1_000, forma: "PIX", createdAt: FORA_DA_JANELA },
      });
      await prisma.comissao.create({
        data: {
          graficaId: f.graficaId,
          orcamentoId: orcamento.id,
          usuarioId: f.usuarioId,
          baseCalculo: "VALOR",
          percentualAplicado: 5,
          valorBase: 1_000,
          valorComissao: 50,
          status: "PAGA",
          pagoEm: FORA_DA_JANELA,
          createdAt: FORA_DA_JANELA,
        },
      });
      await prisma.custoPedido.create({
        data: {
          graficaId: f.graficaId,
          pedidoId: pedido.id,
          categoriaCustoId: f.categoriaVariavelId,
          valor: 100,
          origem: "MANUAL",
          createdAt: FORA_DA_JANELA,
        },
      });
      await prisma.despesa.create({
        data: {
          graficaId: f.graficaId,
          descricao: "Despesa antiga",
          categoriaCustoId: f.categoriaFixaId,
          valor: 200,
          vencimento: FORA_DA_JANELA,
          status: "PAGA",
          pagoEm: FORA_DA_JANELA,
        },
      });

      const dados = await buscarDadosExportacaoFinanceira(f.graficaId, periodo);

      expect(dados.pagamentos).toEqual([]);
      expect(dados.comissoes).toEqual([]);
      expect(dados.custosPorPedido).toEqual([]);
      expect(dados.despesasPagas).toEqual([]);
      expect(dados.agrupamentoCategoria.categorias).toEqual([]);
    },
    TIMEOUT_MS
  );

  it(
    "isola por gráfica: dado de outro tenant nunca aparece",
    async () => {
      const f = await criarFixtureBase();
      const outraFixture = await criarFixtureBase();
      const periodo = periodoHoje();

      const orcamentoOutraGrafica = await criarOrcamentoAprovado(outraFixture, 9_999);
      await prisma.pagamento.create({
        data: { orcamentoId: orcamentoOutraGrafica.id, valor: 9_999, forma: "PIX" },
      });

      const dados = await buscarDadosExportacaoFinanceira(f.graficaId, periodo);

      expect(dados.pagamentos).toEqual([]);
    },
    TIMEOUT_MS
  );

  it(
    "inclui o resultado do DRE do mesmo período (reaproveita buscarDRE, sem recalcular)",
    async () => {
      const f = await criarFixtureBase();
      const periodo = periodoHoje();

      const orcamento = await criarOrcamentoAprovado(f, 10_000);
      await prisma.pedido.create({
        data: { graficaId: f.graficaId, orcamentoId: orcamento.id, status: "ARTE" },
      });

      const dados = await buscarDadosExportacaoFinanceira(f.graficaId, periodo);

      expect(dados.dre.linhas.find((l) => l.rotulo === "Receita bruta")?.valor).toBe(10_000);
    },
    TIMEOUT_MS
  );
});
