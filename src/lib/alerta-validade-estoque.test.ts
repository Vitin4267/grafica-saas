import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { loteEstaProximoOuVencido, listarLotesProximosOuVencidos } from "./alerta-validade-estoque";

// Cobre o achado F4 da Parte 7 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, 2026-09-05) — "Também sem alerta de
// validade (mecânica já existe em alerta-estoque.ts, só falta o dado)".
//
// Decisão de design (documentada também no comentário do arquivo): esta é
// uma função de LEITURA (badge na tela de Catálogo), não um disparo de
// e-mail com dedup — estender verificarEDispararAlertaEstoque exigiria um
// dedup por LOTE (não por item), o que pediria mais um campo em
// MovimentacaoEstoque só pra isso. Autorizado pelo próprio achado: "se a
// mecânica existente for difícil de estender com segurança, é aceitável
// fazer uma função nova e simples que só lê o dado".

describe("loteEstaProximoOuVencido (pura)", () => {
  const agora = new Date("2026-09-05T00:00:00Z");

  it("validade já passada — sempre true, qualquer limiar", () => {
    expect(loteEstaProximoOuVencido(new Date("2026-01-01"), agora, 30)).toBe(true);
  });

  it("validade dentro do limiar de dias — true", () => {
    expect(loteEstaProximoOuVencido(new Date("2026-09-20"), agora, 30)).toBe(true);
  });

  it("validade fora do limiar de dias — false", () => {
    expect(loteEstaProximoOuVencido(new Date("2027-01-01"), agora, 30)).toBe(false);
  });

  it("validade exatamente no limite do limiar — true (inclusivo)", () => {
    const validade = new Date(agora.getTime() + 30 * 86_400_000);
    expect(loteEstaProximoOuVencido(validade, agora, 30)).toBe(true);
  });
});

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.varianteMateriaPrima.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("listarLotesProximosOuVencidos — integração", () => {
  it(
    "item com controlaLote, estoque > 0 e lote vencido aparece na lista",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Validade Estoque ${s}`, slug: `teste-validade-estoque-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel Vencido ${s}`, unidade: "FOLHA" },
      });
      const item = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, controlaLote: true, estoqueAtual: 100 },
      });
      await prisma.movimentacaoEstoque.create({
        data: {
          itemGraficaId: item.id,
          tipo: "ENTRADA_COMPRA",
          quantidade: 100,
          custoUnitario: 1,
          custoTotal: 100,
          lote: "L-VENCIDO",
          validade: new Date("2020-01-01"),
        },
      });

      const resultado = await listarLotesProximosOuVencidos(grafica.id);
      expect(resultado).toHaveLength(1);
      expect(resultado[0]).toMatchObject({ itemGraficaId: item.id, lote: "L-VENCIDO", vencido: true });
    },
    TIMEOUT_MS
  );

  it(
    "item com controlaLote mas estoque ZERADO não aparece (nada em risco de usar num pedido)",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Validade Estoque Zerado ${s}`, slug: `teste-validade-estoque-zerado-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel Zerado ${s}`, unidade: "FOLHA" },
      });
      const item = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, controlaLote: true, estoqueAtual: 0 },
      });
      await prisma.movimentacaoEstoque.create({
        data: {
          itemGraficaId: item.id,
          tipo: "ENTRADA_COMPRA",
          quantidade: 100,
          custoUnitario: 1,
          custoTotal: 100,
          lote: "L-ZERADO",
          validade: new Date("2020-01-01"),
        },
      });

      const resultado = await listarLotesProximosOuVencidos(grafica.id);
      expect(resultado).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "item SEM controlaLote nunca aparece, mesmo com lote/validade vencidos no histórico",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Validade Sem Controle ${s}`, slug: `teste-validade-sem-controle-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel Sem Controle ${s}`, unidade: "FOLHA" },
      });
      const item = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, estoqueAtual: 100 },
      });
      await prisma.movimentacaoEstoque.create({
        data: {
          itemGraficaId: item.id,
          tipo: "ENTRADA_COMPRA",
          quantidade: 100,
          custoUnitario: 1,
          custoTotal: 100,
          lote: "L-FANTASMA",
          validade: new Date("2020-01-01"),
        },
      });

      const resultado = await listarLotesProximosOuVencidos(grafica.id);
      expect(resultado).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "lote com validade distante (fora do limiar) não aparece",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Validade Distante ${s}`, slug: `teste-validade-distante-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);

      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel Longe ${s}`, unidade: "FOLHA" },
      });
      const item = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, controlaLote: true, estoqueAtual: 100 },
      });
      const daquiUmAno = new Date(Date.now() + 365 * 86_400_000);
      await prisma.movimentacaoEstoque.create({
        data: {
          itemGraficaId: item.id,
          tipo: "ENTRADA_COMPRA",
          quantidade: 100,
          custoUnitario: 1,
          custoTotal: 100,
          lote: "L-LONGE",
          validade: daquiUmAno,
        },
      });

      const resultado = await listarLotesProximosOuVencidos(grafica.id);
      expect(resultado).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});
