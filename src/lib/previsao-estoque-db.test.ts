import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularPrevisaoEstoque } from "./previsao-estoque-db";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/catalogo/[itemGraficaId]/acabamento-estrutural.test.ts)
// — cobre o achado A8 da Parte 3 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, "Compras"): fórmula real de ponto de
// pedido (estoque de segurança + consumo médio diário × lead time),
// substituindo o número mágico 30 que existia hardcoded em
// src/app/compras/page.tsx.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260905190000_lead_time_ponto_pedido/migration.sql
// tiver sido aplicada no banco ("parametros_grafica".diasAlertaCompraPadrao/
// leadTimePadraoDias e "itens_grafica".leadTimeDias ainda não existem até
// lá).

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarGrafica(leadTimePadraoDias?: number) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Ponto Pedido ${s}`, slug: `teste-ponto-pedido-${s}` },
  });
  await prisma.parametrosGrafica.create({
    data: {
      graficaId: grafica.id,
      ...(leadTimePadraoDias !== undefined ? { leadTimePadraoDias } : {}),
    },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return grafica.id;
}

// `diasAtras` negativo = no futuro (nunca usado aqui); só um atalho pra
// gerar createdAt relativo a "agora" sem depender de mockar Date.
function ha(diasAtras: number): Date {
  return new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000);
}

async function criarMateriaPrima(
  graficaId: string,
  nome: string,
  opcoes: {
    estoqueAtual: number;
    estoqueMinimo?: number | null;
    leadTimeDias?: number | null;
    // (quantidade, diasAtras)[] — cada uma vira uma MovimentacaoEstoque
    // SAIDA_PRODUCAO dentro da janela de 60 dias usada por calcularPrevisaoEstoque.
    saidas?: [number, number][];
  }
) {
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId, tipo: "MATERIA_PRIMA", categoria: "Papel", nome, unidade: "KG" },
  });
  const item = await prisma.itemGrafica.create({
    data: {
      graficaId,
      itemCatalogoId: catalogo.id,
      estoqueAtual: opcoes.estoqueAtual,
      estoqueMinimo: opcoes.estoqueMinimo ?? null,
      leadTimeDias: opcoes.leadTimeDias ?? null,
    },
  });
  for (const [quantidade, diasAtras] of opcoes.saidas ?? []) {
    await prisma.movimentacaoEstoque.create({
      data: {
        itemGraficaId: item.id,
        tipo: "SAIDA_PRODUCAO",
        quantidade,
        createdAt: ha(diasAtras),
      },
    });
  }
  return item.id;
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("calcularPrevisaoEstoque — ponto de pedido (achado A8)", () => {
  it(
    "usa o leadTimeDias do item quando cadastrado, ignorando o padrão da gráfica",
    async () => {
      const graficaId = await criarGrafica(7); // padrão da gráfica = 7 dias

      // Consumo real: 20 unidades em 10 dias -> 2/dia. Lead time do ITEM = 20
      // dias (papel importado) -> ponto de pedido = 0 (sem estoque de
      // segurança) + 2 × 20 = 40. Estoque atual 100 -> bem acima, não sugere.
      const itemId = await criarMateriaPrima(graficaId, "Papel importado", {
        estoqueAtual: 100,
        estoqueMinimo: 0,
        leadTimeDias: 20,
        saidas: [
          [10, 10],
          [10, 4],
        ],
      });

      const [previsao] = await calcularPrevisaoEstoque(graficaId);

      expect(previsao.id).toBe(itemId);
      expect(previsao.leadTimeDias).toBe(20);
      expect(previsao.consumoMedioDiario).toBeCloseTo(2, 5);
      expect(previsao.pontoDePedido).toBeCloseTo(40, 5);
      expect(previsao.abaixoDoPontoDePedido).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "cai no leadTimePadraoDias da gráfica quando o item não tem lead time próprio",
    async () => {
      const graficaId = await criarGrafica(10); // padrão da gráfica = 10 dias

      // Mesmo consumo (2/dia), sem leadTimeDias no item -> usa o padrão (10)
      // -> ponto de pedido = 5 (segurança) + 2 × 10 = 25. Estoque atual 20
      // já está abaixo -> sugere.
      const itemId = await criarMateriaPrima(graficaId, "Papel nacional", {
        estoqueAtual: 20,
        estoqueMinimo: 5,
        leadTimeDias: null,
        saidas: [
          [10, 10],
          [10, 4],
        ],
      });

      const [previsao] = await calcularPrevisaoEstoque(graficaId);

      expect(previsao.id).toBe(itemId);
      expect(previsao.leadTimeDias).toBe(10);
      expect(previsao.pontoDePedido).toBeCloseTo(25, 5);
      expect(previsao.abaixoDoPontoDePedido).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "sem histórico de consumo suficiente, pontoDePedido é null (não estima do nada)",
    async () => {
      const graficaId = await criarGrafica();

      const itemId = await criarMateriaPrima(graficaId, "Papel sem histórico", {
        estoqueAtual: 50,
        estoqueMinimo: 10,
        leadTimeDias: 15,
        saidas: [], // menos que MINIMO_MOVIMENTACOES
      });

      const [previsao] = await calcularPrevisaoEstoque(graficaId);

      expect(previsao.id).toBe(itemId);
      expect(previsao.consumoMedioDiario).toBeNull();
      expect(previsao.pontoDePedido).toBeNull();
      expect(previsao.abaixoDoPontoDePedido).toBe(false);
      // Continua reportando o lead time efetivo mesmo sem dado de consumo —
      // só a MULTIPLICAÇÃO fica indisponível, não o dado em si.
      expect(previsao.leadTimeDias).toBe(15);
    },
    TIMEOUT_MS
  );

  it(
    "lead time maior (fornecedor de importação) sobe o ponto de pedido mesmo com o mesmo consumo",
    async () => {
      const graficaIdCurto = await criarGrafica(3);
      const graficaIdLongo = await criarGrafica(45);

      await criarMateriaPrima(graficaIdCurto, "Papel A", {
        estoqueAtual: 100,
        estoqueMinimo: 0,
        saidas: [
          [5, 10],
          [5, 4],
        ], // 1/dia
      });
      await criarMateriaPrima(graficaIdLongo, "Papel B", {
        estoqueAtual: 100,
        estoqueMinimo: 0,
        saidas: [
          [5, 10],
          [5, 4],
        ], // 1/dia
      });

      const [previsaoCurto] = await calcularPrevisaoEstoque(graficaIdCurto);
      const [previsaoLongo] = await calcularPrevisaoEstoque(graficaIdLongo);

      expect(previsaoCurto.pontoDePedido).toBeCloseTo(3, 5);
      expect(previsaoLongo.pontoDePedido).toBeCloseTo(45, 5);
      expect(previsaoLongo.pontoDePedido!).toBeGreaterThan(previsaoCurto.pontoDePedido!);
    },
    TIMEOUT_MS
  );
});
