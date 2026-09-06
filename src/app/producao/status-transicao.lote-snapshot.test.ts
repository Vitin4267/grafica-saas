import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusPedido, type PedidoParaAvanco } from "./status-transicao";
import { montarChavePerda } from "@/lib/perda-fixa-producao";

// avancarStatusPedido chama revalidatePath no final — fora de uma requisição
// Next.js de verdade (mesmo mock de status-transicao.custo-automatico.test.ts).
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de status-transicao.substrato-motor.test.ts) — cobre o
// achado F4 da Parte 7 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, 2026-09-05): lote/validade preenchidos
// na ENTRADA_COMPRA são copiados como SNAPSHOT pra dentro da SAIDA_PRODUCAO
// correspondente (ver snapshotLoteFicha em status-transicao.ts), só quando
// a matéria-prima ativou ItemGrafica.controlaLote (opt-in).
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260905200000_estoque_lote_validade_certificacao/migration.sql
// tiver sido aplicada no banco.
const TIMEOUT_MS = 30_000;

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.fichaTecnicaItem.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.varianteMateriaPrima.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

async function criarBase() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Lote Snapshot ${s}`, slug: `teste-lote-snapshot-${s}` },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const usuario = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-lote-snapshot-${s}@example.com`, senhaHash: "x" },
  });
  await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: `Papel ${s}` } });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 500 },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return { s, grafica, cliente, usuario, orcamento };
}

function pedidoParaAvanco(params: { graficaId: string; orcamentoId: string; pedidoId: string }): PedidoParaAvanco {
  return {
    id: params.pedidoId,
    graficaId: params.graficaId,
    orcamentoId: params.orcamentoId,
    status: "CLICHE_FACA",
    arteUrl: null,
    arteAprovadaEm: null,
    producaoLinkToken: null,
    orcamento: {
      clienteId: "cliente-teste",
      condicaoPagamentoId: null,
      total: 0,
      cliente: { nome: "Cliente Teste", telefone: null },
      grafica: { nome: "Gráfica Teste", corPrimaria: null },
      itens: [{ quantidade: 1, itemGrafica: { itemCatalogo: { nome: "Produto Teste" } } }],
    },
  };
}

describe("achado F4 — snapshot de lote/validade da ENTRADA_COMPRA pra SAIDA_PRODUCAO", () => {
  it(
    "controlaLote=true: SAIDA_PRODUCAO copia lote/validade da ENTRADA_COMPRA mais recente",
    async () => {
      const { s, grafica, orcamento } = await criarBase();

      const catalogoPapel = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché ${s}`, unidade: "FOLHA" },
      });
      const papel = await prisma.itemGrafica.create({
        data: {
          graficaId: grafica.id,
          itemCatalogoId: catalogoPapel.id,
          precoCompra: 1,
          estoqueAtual: 1000,
          controlaLote: true,
        },
      });

      // Duas entradas de compra, lotes diferentes — a mais ANTIGA não pode
      // vencer na hora de decidir qual lote snapshotar.
      await prisma.movimentacaoEstoque.create({
        data: {
          itemGraficaId: papel.id,
          tipo: "ENTRADA_COMPRA",
          quantidade: 500,
          custoUnitario: 1,
          custoTotal: 500,
          lote: "LOTE-ANTIGO",
          validade: new Date("2026-06-01"),
          createdAt: new Date("2026-01-01T10:00:00Z"),
        },
      });
      await prisma.movimentacaoEstoque.create({
        data: {
          itemGraficaId: papel.id,
          tipo: "ENTRADA_COMPRA",
          quantidade: 500,
          custoUnitario: 1,
          custoTotal: 500,
          lote: "LOTE-RECENTE",
          validade: new Date("2027-06-01"),
          createdAt: new Date("2026-02-01T10:00:00Z"),
        },
      });

      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
      });
      const ficha = await prisma.fichaTecnicaItem.create({
        data: { itemGraficaId: produto.id, materiaPrimaId: papel.id, quantidadePorUnidade: 2 },
      });

      const quantidadeItem = 10;
      const orcamentoItem = await prisma.orcamentoItem.create({
        data: {
          orcamentoId: orcamento.id,
          itemGraficaId: produto.id,
          quantidade: quantidadeItem,
          precoUnitario: 50,
          precoTotal: 500,
        },
      });

      const pedido = await prisma.pedido.create({
        data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "CLICHE_FACA" },
      });

      const perdas = JSON.stringify([{ chave: montarChavePerda(orcamentoItem.id, ficha.id), perdaAplicada: 0 }]);

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco({ graficaId: grafica.id, orcamentoId: orcamento.id, pedidoId: pedido.id }),
        perdas
      );
      expect(resultado.ok).toBe(true);

      const saida = await prisma.movimentacaoEstoque.findFirstOrThrow({
        where: { pedidoId: pedido.id, itemGraficaId: papel.id, tipo: "SAIDA_PRODUCAO" },
      });
      // Copia o lote mais RECENTE (não o mais antigo) — rastro documentado,
      // não FEFO (ver comentário em snapshotLoteFicha).
      expect(saida.lote).toBe("LOTE-RECENTE");
      expect(saida.validade?.toISOString().slice(0, 10)).toBe("2027-06-01");
    },
    TIMEOUT_MS
  );

  it(
    "controlaLote=false (default): SAIDA_PRODUCAO NUNCA copia lote, mesmo que existam ENTRADA_COMPRA com lote preenchido",
    async () => {
      const { s, grafica, orcamento } = await criarBase();

      const catalogoPapel = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché Sem Lote ${s}`, unidade: "FOLHA" },
      });
      // controlaLote NÃO ativado (default false) — zero regressão pra quem
      // nunca ligou o opt-in, mesmo que por algum motivo já exista uma
      // ENTRADA_COMPRA com lote no histórico (ex: ligou, comprou, desligou).
      const papel = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoPapel.id, precoCompra: 1, estoqueAtual: 1000 },
      });
      await prisma.movimentacaoEstoque.create({
        data: {
          itemGraficaId: papel.id,
          tipo: "ENTRADA_COMPRA",
          quantidade: 500,
          custoUnitario: 1,
          custoTotal: 500,
          lote: "LOTE-FANTASMA",
          validade: new Date("2027-01-01"),
        },
      });

      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão Sem Lote ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
      });
      const ficha = await prisma.fichaTecnicaItem.create({
        data: { itemGraficaId: produto.id, materiaPrimaId: papel.id, quantidadePorUnidade: 2 },
      });

      const quantidadeItem = 10;
      const orcamentoItem = await prisma.orcamentoItem.create({
        data: {
          orcamentoId: orcamento.id,
          itemGraficaId: produto.id,
          quantidade: quantidadeItem,
          precoUnitario: 50,
          precoTotal: 500,
        },
      });

      const pedido = await prisma.pedido.create({
        data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "CLICHE_FACA" },
      });

      const perdas = JSON.stringify([{ chave: montarChavePerda(orcamentoItem.id, ficha.id), perdaAplicada: 0 }]);

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco({ graficaId: grafica.id, orcamentoId: orcamento.id, pedidoId: pedido.id }),
        perdas
      );
      expect(resultado.ok).toBe(true);

      const saida = await prisma.movimentacaoEstoque.findFirstOrThrow({
        where: { pedidoId: pedido.id, itemGraficaId: papel.id, tipo: "SAIDA_PRODUCAO" },
      });
      expect(saida.lote).toBeNull();
      expect(saida.validade).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "controlaLote=true com VARIANTE: snapshot usa o lote da ENTRADA_COMPRA daquela variante especificamente, não do item pai",
    async () => {
      const { s, grafica, orcamento } = await criarBase();

      const catalogoChapa = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Chapa", nome: `Chapa ${s}`, unidade: "UNIDADE" },
      });
      const chapa = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoChapa.id, controlaLote: true },
      });
      const variante2mm = await prisma.varianteMateriaPrima.create({
        data: { itemGraficaId: chapa.id, rotulo: "2mm", precoCompra: 10, estoqueAtual: 100 },
      });

      // Entrada SEM variante (lote do "pai") e entrada COM variante (lote da
      // 2mm) — a baixa que usa a variante não pode pegar o lote do pai.
      await prisma.movimentacaoEstoque.create({
        data: {
          itemGraficaId: chapa.id,
          varianteId: null,
          tipo: "ENTRADA_COMPRA",
          quantidade: 50,
          custoUnitario: 10,
          custoTotal: 500,
          lote: "LOTE-PAI",
          validade: new Date("2026-08-01"),
        },
      });
      await prisma.movimentacaoEstoque.create({
        data: {
          itemGraficaId: chapa.id,
          varianteId: variante2mm.id,
          tipo: "ENTRADA_COMPRA",
          quantidade: 50,
          custoUnitario: 10,
          custoTotal: 500,
          lote: "LOTE-2MM",
          validade: new Date("2027-08-01"),
        },
      });

      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Corte", nome: `Peça Cortada ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
      });
      const ficha = await prisma.fichaTecnicaItem.create({
        data: {
          itemGraficaId: produto.id,
          materiaPrimaId: chapa.id,
          varianteId: variante2mm.id,
          quantidadePorUnidade: 1,
        },
      });

      const quantidadeItem = 5;
      const orcamentoItem = await prisma.orcamentoItem.create({
        data: {
          orcamentoId: orcamento.id,
          itemGraficaId: produto.id,
          quantidade: quantidadeItem,
          precoUnitario: 50,
          precoTotal: 250,
        },
      });

      const pedido = await prisma.pedido.create({
        data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "CLICHE_FACA" },
      });

      const perdas = JSON.stringify([{ chave: montarChavePerda(orcamentoItem.id, ficha.id), perdaAplicada: 0 }]);

      const resultado = await avancarStatusPedido(
        pedidoParaAvanco({ graficaId: grafica.id, orcamentoId: orcamento.id, pedidoId: pedido.id }),
        perdas
      );
      expect(resultado.ok).toBe(true);

      const saida = await prisma.movimentacaoEstoque.findFirstOrThrow({
        where: { pedidoId: pedido.id, varianteId: variante2mm.id, tipo: "SAIDA_PRODUCAO" },
      });
      expect(saida.lote).toBe("LOTE-2MM");
      expect(saida.validade?.toISOString().slice(0, 10)).toBe("2027-08-01");
    },
    TIMEOUT_MS
  );
});
