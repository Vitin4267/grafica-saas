import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/orcamento/[id]/actions.dimensoes-item.test.ts) —
// cobre os achados A4 (BORDADO) e A6 (TEMPO_MAQUINA) da Parte 1 da auditoria
// de abrangência (pesquisa-abrangencia-modulos.md): ponta a ponta de criar
// um item de orçamento com cada modelo novo via adicionarItemOrcamento,
// passando por carregarContextoPrecificacao (branches novos) e
// calcularBordado/calcularTempoMaquina de verdade.
//
// IMPORTANTE: a migration 20260902100000_bordado_tempo_maquina foi escrita à
// mão mas NÃO foi aplicada ao banco de dev (regra do projeto — migrations
// nunca são aplicadas por este agente). Este arquivo só passa depois que
// alguém aplicar essa migration.
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

import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { adicionarItemOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type FixtureBase = {
  graficaId: string;
  usuarioId: string;
  clienteId: string;
  orcamentoId: string;
};

async function criarFixtureBase(nomeTeste: string): Promise<FixtureBase> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste ${nomeTeste} ${s}`, slug: `teste-${nomeTeste}-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Usuário ${s}`,
      email: `user-${nomeTeste}-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "RASCUNHO", total: 0 },
  });

  return {
    graficaId: grafica.id,
    usuarioId: usuario.id,
    clienteId: cliente.id,
    orcamentoId: orcamento.id,
  };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function usuarioParaMock(usuarioId: string) {
  return prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.maquinaBordado.deleteMany({ where: { graficaId } });
    await prisma.maquinaTempo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("adicionarItemOrcamento — BORDADO (achado A4, ponta a ponta)", () => {
  it(
    "cria o item com custo = matriz(1×) + Q×(pontos/1000×custoPorMilPontos) + Q×substrato, gravando numeroPontos",
    async () => {
      const fixture = await criarFixtureBase("bordado");
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const s = sufixo();
      const maquina = await prisma.maquinaBordado.create({
        data: {
          graficaId: fixture.graficaId,
          nome: `Tajima 6 cabeças ${s}`,
          custoPorMilPontos: 0.75,
          custoMatrizDigitalizacao: 20,
          cabecas: 6,
        },
      });
      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: fixture.graficaId, tipo: "PRODUTO", categoria: "Boné", nome: `Boné Bordado ${s}` },
      });
      const itemGrafica = await prisma.itemGrafica.create({
        data: {
          graficaId: fixture.graficaId,
          itemCatalogoId: catalogo.id,
          precoVenda: 50,
          precoCompra: 12, // custo do substrato (boné em branco)
          modeloCalculo: "BORDADO",
          maquinaBordadoId: maquina.id,
        },
      });

      const resultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: itemGrafica.id,
          quantidade: "20",
          unidadeDimensao: "CM",
          numeroPontos: "8000",
        })
      );

      expect(resultado.ok).toBe(true);
      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(item.modeloCalculo).toBe("BORDADO");
      expect(item.numeroPontos).toBe(8000);

      // custoMatriz = 20; custoPontos = 20×(8000/1000×0,75) = 20×6 = 120;
      // custoSubstrato = 20×12 = 240; custoBase (custoDireto) = 380.
      const breakdown = item.breakdown as { custoDireto: string } | null;
      expect(breakdown).not.toBeNull();
      expect(Number(breakdown!.custoDireto)).toBeCloseTo(380, 6);
      // Preço final tem que ficar acima do custo direto (overhead/margem/imposto).
      expect(Number(item.precoTotal)).toBeGreaterThan(380);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita quando numeroPontos não é informado (obrigatório, sem default)",
    async () => {
      const fixture = await criarFixtureBase("bordado-sem-pontos");
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const s = sufixo();
      const maquina = await prisma.maquinaBordado.create({
        data: { graficaId: fixture.graficaId, nome: `Bordadeira ${s}`, custoPorMilPontos: 0.75, custoMatrizDigitalizacao: 20 },
      });
      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: fixture.graficaId, tipo: "PRODUTO", categoria: "Boné", nome: `Boné Bordado ${s}` },
      });
      const itemGrafica = await prisma.itemGrafica.create({
        data: {
          graficaId: fixture.graficaId,
          itemCatalogoId: catalogo.id,
          precoVenda: 50,
          precoCompra: 12,
          modeloCalculo: "BORDADO",
          maquinaBordadoId: maquina.id,
        },
      });

      const resultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: itemGrafica.id,
          quantidade: "20",
          unidadeDimensao: "CM",
        })
      );

      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );
});

describe("adicionarItemOrcamento — TEMPO_MAQUINA (achado A6, ponta a ponta)", () => {
  it(
    "cria o item com custo = tempo/60×custoHoraMaq + metros×custoPorMetroCorte + setup, gravando tempoEstimadoMin/metrosCorte",
    async () => {
      const fixture = await criarFixtureBase("tempo-maquina");
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const s = sufixo();
      const maquina = await prisma.maquinaTempo.create({
        data: {
          graficaId: fixture.graficaId,
          nome: `Router CNC ${s}`,
          custoHoraMaq: 60,
          custoSetupPorJob: 15,
          custoPorMetroCorte: 2,
        },
      });
      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: fixture.graficaId, tipo: "PRODUTO", categoria: "Placa", nome: `Placa Acrílico Cortada ${s}` },
      });
      const itemGrafica = await prisma.itemGrafica.create({
        data: {
          graficaId: fixture.graficaId,
          itemCatalogoId: catalogo.id,
          precoVenda: 200,
          modeloCalculo: "TEMPO_MAQUINA",
          maquinaTempoId: maquina.id,
        },
      });

      const resultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: itemGrafica.id,
          quantidade: "5",
          unidadeDimensao: "CM",
          tempoEstimadoMin: "40",
          metrosCorte: "10",
        })
      );

      expect(resultado.ok).toBe(true);
      const item = await prisma.orcamentoItem.findFirstOrThrow({
        where: { orcamentoId: fixture.orcamentoId },
      });
      expect(item.modeloCalculo).toBe("TEMPO_MAQUINA");
      expect(item.tempoEstimadoMin?.toString()).toBe("40");
      expect(item.metrosCorte?.toString()).toBe("10");

      // custoTempo = 40/60×60 = 40; custoCorte = 10×2 = 20; custoSetup = 15
      // custoBase (custoDireto) = 75.
      const breakdown = item.breakdown as { custoDireto: string } | null;
      expect(breakdown).not.toBeNull();
      expect(Number(breakdown!.custoDireto)).toBeCloseTo(75, 6);
      expect(Number(item.precoTotal)).toBeGreaterThan(75);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita quando nem tempoEstimadoMin nem metrosCorte são informados",
    async () => {
      const fixture = await criarFixtureBase("tempo-maquina-sem-base");
      graficaIdsParaLimpar.push(fixture.graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(fixture.usuarioId)) as never
      );

      const s = sufixo();
      const maquina = await prisma.maquinaTempo.create({
        data: { graficaId: fixture.graficaId, nome: `Laser CO2 ${s}`, custoHoraMaq: 60, custoSetupPorJob: 15 },
      });
      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: fixture.graficaId, tipo: "PRODUTO", categoria: "Placa", nome: `Placa Cortada ${s}` },
      });
      const itemGrafica = await prisma.itemGrafica.create({
        data: {
          graficaId: fixture.graficaId,
          itemCatalogoId: catalogo.id,
          precoVenda: 200,
          modeloCalculo: "TEMPO_MAQUINA",
          maquinaTempoId: maquina.id,
        },
      });

      const resultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: fixture.orcamentoId,
          itemGraficaId: itemGrafica.id,
          quantidade: "5",
          unidadeDimensao: "CM",
        })
      );

      expect(resultado.ok).toBe(false);
    },
    TIMEOUT_MS
  );
});
