import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { resolverEtapasGrafica, garantirEtapasGraficaPadrao } from "@/lib/etapa-grafica";
import { mapearDadosOrdemProducao, type PedidoParaOrdemProducao } from "./mapear-dados-ordem-producao";

// Achado A2 da auditoria de abrangência (Parte 2, seção A) — antes desta
// correção, o PDF de ordem de produção (documento interno de chão de
// fábrica, /producao/[pedidoId]/ordem-producao) ignorava o rótulo
// customizado da gráfica pro estágio: OrdemProducaoDocumento.tsx tinha seu
// PRÓPRIO mapa fixo (ROTULO_STATUS) e re-traduzia o StatusPedido cru pro
// nome genérico do sistema, mesmo quando a gráfica tinha customizado (ex:
// "Queima de tela" numa serigrafia). Este teste é de INTEGRAÇÃO de verdade
// (toca o Postgres de dev via DATABASE_URL, mesmo padrão de
// status-transicao.etapa-grafica.test.ts): resolve o rótulo por gráfica de
// verdade via resolverEtapasGrafica e confere que ele chega intocado em
// DadosPdfOrdemProducao.statusRotulo — o único campo que
// OrdemProducaoDocumento.tsx lê pra desenhar o texto do status (ver comentário
// de `statusRotulo` no próprio tipo).
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const TIMEOUT_MS = 30_000;

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.etapaGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
});

// Fixture mínima — só o suficiente pra mapearDadosOrdemProducao rodar sem
// lançar (mesmo espírito de orcamentoBase em mapear-dados.test.ts): nenhum
// item, nenhuma ficha técnica, o que importa aqui é só o rótulo de status.
function pedidoBase(overrides: Partial<PedidoParaOrdemProducao> = {}): PedidoParaOrdemProducao {
  return {
    id: "pedido-teste-01234567",
    createdAt: new Date("2026-09-01"),
    prazoEntrega: null,
    orcamento: {
      observacoes: null,
      cliente: { nome: "Cliente Teste", preferenciasProducao: null },
      grafica: { nome: "Gráfica Teste" },
      itens: [],
    },
    ...overrides,
  };
}

describe("mapearDadosOrdemProducao — rótulo de status (achado A2)", () => {
  it("usa exatamente o texto passado em rotuloStatus, sem re-traduzir por conta própria", () => {
    const dados = mapearDadosOrdemProducao(pedidoBase(), "Queima de tela");
    expect(dados.statusRotulo).toBe("Queima de tela");
  });

  it(
    "end-to-end: rótulo customizado de CLICHE_FACA em EtapaGrafica chega intocado em statusRotulo",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste PDF Ordem Producao ${s}`, slug: `teste-pdf-ordem-producao-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      await garantirEtapasGraficaPadrao(grafica.id);
      await prisma.etapaGrafica.update({
        where: { graficaId_status: { graficaId: grafica.id, status: "CLICHE_FACA" } },
        data: { rotulo: "Queima de tela" },
      });

      // Mesma chamada que src/app/producao/[pedidoId]/ordem-producao/route.tsx
      // faz de verdade: resolve por gráfica, depois passa pro mapper.
      const etapas = await resolverEtapasGrafica(grafica.id);
      const dados = mapearDadosOrdemProducao(pedidoBase(), etapas.rotulos.CLICHE_FACA);

      expect(dados.statusRotulo).toBe("Queima de tela");
      expect(dados.statusRotulo).not.toBe("Clichê/Faca");
      expect(dados.statusRotulo).not.toBe("Pré-impressão");
    },
    TIMEOUT_MS
  );

  it(
    "gráfica sem customização nenhuma cai no default do sistema — 'Pré-impressão', não 'Clichê/Faca' (achado A2)",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste PDF Default ${s}`, slug: `teste-pdf-default-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      const etapas = await resolverEtapasGrafica(grafica.id);
      const dados = mapearDadosOrdemProducao(pedidoBase(), etapas.rotulos.CLICHE_FACA);

      expect(dados.statusRotulo).toBe("Pré-impressão");
    },
    TIMEOUT_MS
  );
});
