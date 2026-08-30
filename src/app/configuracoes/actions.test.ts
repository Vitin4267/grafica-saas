import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO — toca o Postgres de dev via DATABASE_URL
// Cobre o achado A13 da Parte 6 da auditoria de abrangência (2026-08-29):
// adição do campo toleranciaTiragemPercent em ParametrosGrafica
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260830140000_parametros_tolerancia_tiragem/migration.sql
// tiver sido aplicada no banco.

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
import { salvarParametros } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioId: string;
};

async function criarFixture(): Promise<Fixture> {
  const graficaNome = `Teste tolerância ${sufixo()}`;
  const grafica = await prisma.grafica.create({
    data: {
      nome: graficaNome,
      slug: graficaNome.toLowerCase().replace(/\s+/g, "-"),
    },
  });

  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: "Teste",
      email: `teste-${sufixo()}@example.com`,
      senhaHash: "hash",
      papel: "DONO",
      emailVerificadoEm: new Date(),
    },
  });

  // Criar ParametrosGrafica padrão
  await prisma.parametrosGrafica.create({
    data: {
      graficaId: grafica.id,
      overheadPercent: 0.15,
      margemPadrao: 0.2,
      impostoPercent: 0.06,
      comissaoPercent: 0,
      taxaFinanceiraPercent: 0,
      pedidoMinimo: 0,
      incrementoArredondamento: 0.1,
      margemSegurancaPadrao: 0.02,
      gapPecasPadrao: 0.008,
      margemFaixaBaixa: 10,
      margemFaixaBoa: 25,
      descontoMaxSemAprovacao: 100,
      toleranciaTiragemPadraoPercent: 10,
      toleranciaTiragemPercent: 0,
      diasPrecoInsumoDesatualizado: 90,
    },
  });

  return { graficaId: grafica.id, usuarioId: usuario.id };
}

async function limparFixture(fixture: Fixture) {
  // Deletar em cascata
  await prisma.grafica.delete({
    where: { id: fixture.graficaId },
  });
}

describe("salvarParametros", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) {
      await limparFixture(fixture);
    }
  });

  it("deve salvar toleranciaTiragemPercent e registrar no log de auditoria", async () => {
      fixture = await criarFixture();

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue({
        id: fixture.usuarioId,
        graficaId: fixture.graficaId,
        nome: "Teste",
        email: "teste@example.com",
        papel: "DONO",
      } as any);

      const formData = new FormData();
      formData.append("overheadPercent", "0.15");
      formData.append("margemPadrao", "0.20");
      formData.append("impostoPercent", "0.06");
      formData.append("comissaoPercent", "0");
      formData.append("taxaFinanceiraPercent", "0");
      formData.append("pedidoMinimo", "0");
      formData.append("incrementoArredondamento", "0.10");
      formData.append("margemSegurancaPadrao", "0.02");
      formData.append("gapPecasPadrao", "0.008");
      formData.append("comissaoVendedorBase", "VALOR");
      formData.append("unidadePadraoDimensao", "CM");
      formData.append("diasValidadeOrcamentoPadrao", "15");
      formData.append("diasAlertaOrcamentoParado", "5");
      formData.append("alertaPrazoAtivo", "on");
      formData.append("alertaPrazoLimiar1Dias", "5");
      formData.append("alertaPrazoLimiar2Dias", "3");
      formData.append("alertaPrazoLimiar3Dias", "0");
      formData.append("mostrarEspecificacoesTecnicas", "on");
      formData.append("custoAutomaticoConsumo", "on");
      formData.append("perdaEhCustoDoPedido", "on");
      formData.append("comissaoEntraNoCustoPedido", "off");
      formData.append("bloqueiaAoUltrapassarLimiteCredito", "off");
      formData.append("margemFaixaBaixa", "10");
      formData.append("margemFaixaBoa", "25");
      formData.append("descontoMaxSemAprovacao", "100");
      formData.append("toleranciaTiragemPadraoPercent", "10");
      formData.append("toleranciaTiragemPercent", "5"); // Novo campo
      formData.append("diasPrecoInsumoDesatualizado", "90");
      formData.append("prazoEmDiasUteis", "on");
      formData.append("diaFuncionamento", "0");
      formData.append("diaFuncionamento", "1");
      formData.append("diaFuncionamento", "2");
      formData.append("diaFuncionamento", "3");
      formData.append("diaFuncionamento", "4");

      const resultado = await salvarParametros(null, formData);

      expect(resultado.ok).toBe(true);
      expect(resultado.mensagem).toContain("sucesso");

      // Verificar que foi gravado no banco
      const parametrosSalvos = await prisma.parametrosGrafica.findUnique({
        where: { graficaId: fixture.graficaId },
      });

      expect(Number(parametrosSalvos?.toleranciaTiragemPercent)).toEqual(5);

      // Verificar se foi registrado no log de auditoria
      const logs = await prisma.logAuditoria.findMany({
        where: {
          graficaId: fixture.graficaId,
          acao: "configuracoes.salvar_parametros",
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      expect(logs.length).toBeGreaterThan(0);
      const ultimoLog = logs[0];
      expect(ultimoLog.valorNovo).toContain("Tolerância de tiragem: 5%");
  }, TIMEOUT_MS);

  it("deve aceitar toleranciaTiragemPercent = 0 (sem tolerância)", async () => {
      fixture = await criarFixture();

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue({
        id: fixture.usuarioId,
        graficaId: fixture.graficaId,
        nome: "Teste",
        email: "teste@example.com",
        papel: "DONO",
      } as any);

      const formData = new FormData();
      formData.append("overheadPercent", "0.15");
      formData.append("margemPadrao", "0.20");
      formData.append("impostoPercent", "0.06");
      formData.append("comissaoPercent", "0");
      formData.append("taxaFinanceiraPercent", "0");
      formData.append("pedidoMinimo", "0");
      formData.append("incrementoArredondamento", "0.10");
      formData.append("margemSegurancaPadrao", "0.02");
      formData.append("gapPecasPadrao", "0.008");
      formData.append("comissaoVendedorBase", "VALOR");
      formData.append("unidadePadraoDimensao", "CM");
      formData.append("diasValidadeOrcamentoPadrao", "15");
      formData.append("diasAlertaOrcamentoParado", "5");
      formData.append("alertaPrazoAtivo", "on");
      formData.append("alertaPrazoLimiar1Dias", "5");
      formData.append("alertaPrazoLimiar2Dias", "3");
      formData.append("alertaPrazoLimiar3Dias", "0");
      formData.append("mostrarEspecificacoesTecnicas", "on");
      formData.append("custoAutomaticoConsumo", "on");
      formData.append("perdaEhCustoDoPedido", "on");
      formData.append("comissaoEntraNoCustoPedido", "off");
      formData.append("bloqueiaAoUltrapassarLimiteCredito", "off");
      formData.append("margemFaixaBaixa", "10");
      formData.append("margemFaixaBoa", "25");
      formData.append("descontoMaxSemAprovacao", "100");
      formData.append("toleranciaTiragemPadraoPercent", "10");
      formData.append("toleranciaTiragemPercent", "0"); // Sem tolerância
      formData.append("diasPrecoInsumoDesatualizado", "90");
      formData.append("prazoEmDiasUteis", "on");
      formData.append("diaFuncionamento", "0");
      formData.append("diaFuncionamento", "1");
      formData.append("diaFuncionamento", "2");
      formData.append("diaFuncionamento", "3");
      formData.append("diaFuncionamento", "4");

      const resultado = await salvarParametros(null, formData);

      expect(resultado.ok).toBe(true);

      const parametrosSalvos = await prisma.parametrosGrafica.findUnique({
        where: { graficaId: fixture.graficaId },
      });

      expect(Number(parametrosSalvos?.toleranciaTiragemPercent)).toEqual(0);
  }, TIMEOUT_MS);
});
