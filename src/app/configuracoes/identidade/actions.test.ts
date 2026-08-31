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
import { salvarDadosPagamento, salvarSegmento } from "./actions";

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

// Cobre o achado F9 da Parte 7 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, 2026-08-31): `Grafica.segmentosSecundarios`
// (array aditivo sobre o mesmo enum de `segmento`) + os 5 valores novos de
// `SegmentoGrafica`.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260831120000_grafica_segmentos_secundarios/migration.sql
// tiver sido aplicada no banco.
describe("salvarSegmento (achado F9 — segmentosSecundarios)", () => {
  let fixture: Fixture;

  afterEach(async () => {
    if (fixture) {
      await limparFixture(fixture);
    }
  });

  it("salva segmento principal + segmentosSecundarios (incluindo os 5 valores novos do enum)", async () => {
    fixture = await criarFixture();

    vi.mocked(exigirUsuarioAutenticado).mockResolvedValue({
      id: fixture.usuarioId,
      graficaId: fixture.graficaId,
      nome: "Teste",
      email: "teste@example.com",
      papel: "DONO",
    } as any);

    const formData = new FormData();
    formData.append("segmento", "OFFSET_COMERCIAL");
    formData.append("segmentosSecundarios", "SERIGRAFIA");
    formData.append("segmentosSecundarios", "SINALIZACAO_ADESIVAGEM");

    const resultado = await salvarSegmento(null, formData);

    expect(resultado.ok).toBe(true);

    const graficaSalva = await prisma.grafica.findUnique({ where: { id: fixture.graficaId } });
    expect(graficaSalva?.segmento).toBe("OFFSET_COMERCIAL");
    expect(graficaSalva?.segmentosSecundarios.sort()).toEqual(
      ["SERIGRAFIA", "SINALIZACAO_ADESIVAGEM"].sort()
    );
  }, TIMEOUT_MS);

  it("descarta duplicatas e o valor igual ao segmento principal, sem erro", async () => {
    fixture = await criarFixture();

    vi.mocked(exigirUsuarioAutenticado).mockResolvedValue({
      id: fixture.usuarioId,
      graficaId: fixture.graficaId,
      nome: "Teste",
      email: "teste@example.com",
      papel: "DONO",
    } as any);

    const formData = new FormData();
    formData.append("segmento", "FLEXOGRAFIA");
    formData.append("segmentosSecundarios", "FLEXOGRAFIA"); // igual ao principal
    formData.append("segmentosSecundarios", "BORDADO");
    formData.append("segmentosSecundarios", "BORDADO"); // duplicata

    const resultado = await salvarSegmento(null, formData);

    expect(resultado.ok).toBe(true);

    const graficaSalva = await prisma.grafica.findUnique({ where: { id: fixture.graficaId } });
    expect(graficaSalva?.segmentosSecundarios).toEqual(["BORDADO"]);
  }, TIMEOUT_MS);

  it("rejeita segmento secundário fora da lista fechada", async () => {
    fixture = await criarFixture();

    vi.mocked(exigirUsuarioAutenticado).mockResolvedValue({
      id: fixture.usuarioId,
      graficaId: fixture.graficaId,
      nome: "Teste",
      email: "teste@example.com",
      papel: "DONO",
    } as any);

    const formData = new FormData();
    formData.append("segmentosSecundarios", "MARCENARIA");

    const resultado = await salvarSegmento(null, formData);

    expect(resultado.ok).toBe(false);
    expect(resultado.mensagem).toContain("inválido");
  }, TIMEOUT_MS);

  it("rejeita OUTRO como segmento secundário (sem campo-irmão pra detalhar)", async () => {
    fixture = await criarFixture();

    vi.mocked(exigirUsuarioAutenticado).mockResolvedValue({
      id: fixture.usuarioId,
      graficaId: fixture.graficaId,
      nome: "Teste",
      email: "teste@example.com",
      papel: "DONO",
    } as any);

    const formData = new FormData();
    formData.append("segmentosSecundarios", "OUTRO");

    const resultado = await salvarSegmento(null, formData);

    expect(resultado.ok).toBe(false);
  }, TIMEOUT_MS);

  it("aceita lista vazia (gráfica que não marcou nenhum segmento secundário)", async () => {
    fixture = await criarFixture();

    vi.mocked(exigirUsuarioAutenticado).mockResolvedValue({
      id: fixture.usuarioId,
      graficaId: fixture.graficaId,
      nome: "Teste",
      email: "teste@example.com",
      papel: "DONO",
    } as any);

    const resultado = await salvarSegmento(null, new FormData());

    expect(resultado.ok).toBe(true);

    const graficaSalva = await prisma.grafica.findUnique({ where: { id: fixture.graficaId } });
    expect(graficaSalva?.segmentosSecundarios).toEqual([]);
  }, TIMEOUT_MS);
});
