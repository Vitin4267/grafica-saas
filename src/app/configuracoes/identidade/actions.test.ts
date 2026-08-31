import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO — toca o Postgres de dev via DATABASE_URL (mesmo
// padrão de src/app/configuracoes/actions.test.ts).
//
// Cobre o achado F6 da Parte 7 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, 2026-08-31): 4 campos novos em Grafica
// (chavePix, tipoChavePix, favorecidoPix, dadosBancarios) — dados de
// RECEBIMENTO da gráfica, só exibição, nunca validados.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260831110000_grafica_chave_pix/migration.sql
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
import { salvarDadosPagamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioId: string;
};

async function criarFixture(): Promise<Fixture> {
  const graficaNome = `Teste PIX ${sufixo()}`;
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

  return { graficaId: grafica.id, usuarioId: usuario.id };
}

async function limparFixture(fixture: Fixture) {
  await prisma.grafica.delete({ where: { id: fixture.graficaId } });
}

describe("salvarDadosPagamento (achado F6)", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) {
      await limparFixture(fixture);
    }
  });

  it("salva os 4 campos e registra no log de auditoria", async () => {
    fixture = await criarFixture();

    vi.mocked(exigirUsuarioAutenticado).mockResolvedValue({
      id: fixture.usuarioId,
      graficaId: fixture.graficaId,
      nome: "Teste",
      email: "teste@example.com",
      papel: "DONO",
    } as any);

    const formData = new FormData();
    formData.append("chavePix", "contato@grafica.com.br");
    formData.append("tipoChavePix", "EMAIL");
    formData.append("favorecidoPix", "Gráfica Teste LTDA");
    formData.append("dadosBancarios", "Banco X, ag. 0001, c/c 12345-6");

    const resultado = await salvarDadosPagamento(null, formData);

    expect(resultado.ok).toBe(true);
    expect(resultado.mensagem).toContain("sucesso");

    const graficaSalva = await prisma.grafica.findUnique({
      where: { id: fixture.graficaId },
    });

    expect(graficaSalva?.chavePix).toBe("contato@grafica.com.br");
    expect(graficaSalva?.tipoChavePix).toBe("EMAIL");
    expect(graficaSalva?.favorecidoPix).toBe("Gráfica Teste LTDA");
    expect(graficaSalva?.dadosBancarios).toBe("Banco X, ag. 0001, c/c 12345-6");

    const logs = await prisma.logAuditoria.findMany({
      where: {
        graficaId: fixture.graficaId,
        acao: "configuracoes.salvar_dados_pagamento",
      },
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].valorNovo).toContain("E-mail");
  }, TIMEOUT_MS);

  it("aceita todos os campos vazios (gráfica que nunca cadastrou nada continua null)", async () => {
    fixture = await criarFixture();

    vi.mocked(exigirUsuarioAutenticado).mockResolvedValue({
      id: fixture.usuarioId,
      graficaId: fixture.graficaId,
      nome: "Teste",
      email: "teste@example.com",
      papel: "DONO",
    } as any);

    const formData = new FormData();

    const resultado = await salvarDadosPagamento(null, formData);

    expect(resultado.ok).toBe(true);

    const graficaSalva = await prisma.grafica.findUnique({
      where: { id: fixture.graficaId },
    });

    expect(graficaSalva?.chavePix).toBeNull();
    expect(graficaSalva?.tipoChavePix).toBeNull();
    expect(graficaSalva?.favorecidoPix).toBeNull();
    expect(graficaSalva?.dadosBancarios).toBeNull();
  }, TIMEOUT_MS);

  it("rejeita tipoChavePix fora da lista fechada", async () => {
    fixture = await criarFixture();

    vi.mocked(exigirUsuarioAutenticado).mockResolvedValue({
      id: fixture.usuarioId,
      graficaId: fixture.graficaId,
      nome: "Teste",
      email: "teste@example.com",
      papel: "DONO",
    } as any);

    const formData = new FormData();
    formData.append("chavePix", "11999998888");
    formData.append("tipoChavePix", "BITCOIN");

    const resultado = await salvarDadosPagamento(null, formData);

    expect(resultado.ok).toBe(false);
    expect(resultado.mensagem).toContain("inválido");
  }, TIMEOUT_MS);
});
