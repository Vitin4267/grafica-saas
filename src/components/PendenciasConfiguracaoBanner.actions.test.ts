import { describe, it, expect, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO — toca o Postgres de dev via DATABASE_URL.
// Cobre o fix do bug do botão "Depois" (expansão modal->banner, 2026-09-14):
// antes, a dispensa só vivia num useState client-side que resetava a cada
// navegação de página. Agora vive em Sessao.pendenciasDispensadas — precisa
// sobreviver a uma "nova requisição" na MESMA sessão, mas resetar quando é
// uma sessão NOVA (próximo login).
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260914100000_sessao_pendencias_dispensadas/migration.sql
// tiver sido aplicada no banco.

vi.mock("@/lib/auth/session", () => ({
  obterUsuarioAtual: vi.fn(),
  obterSessaoAtual: vi.fn(),
  exigirUsuarioAutenticado: vi.fn(),
}));
vi.mock("@/lib/onboarding", () => ({
  obterStatusOnboarding: vi.fn(async () => ({ completo: true })),
}));
vi.mock("@/lib/pendencias-configuracao", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/pendencias-configuracao")>();
  return { ...real, listarPendenciasConfiguracao: vi.fn() };
});
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { obterUsuarioAtual, obterSessaoAtual } from "@/lib/auth/session";
import { listarPendenciasConfiguracao, type PendenciaConfiguracao } from "@/lib/pendencias-configuracao";
import { chaveDaPendencia } from "@/lib/pendencia-chave";
import { obterPendenciasConfiguracao, dispensarPendencia } from "./PendenciasConfiguracaoBanner.actions";

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const PENDENCIA_FIXA: PendenciaConfiguracao = {
  tipo: "PAPEL_MATERIA_PRIMA_FALTANDO",
  itemGraficaId: `item-${sufixo()}`,
  nomeProduto: "Etiqueta teste",
};

async function criarSessaoNoBanco(usuarioId: string) {
  return prisma.sessao.create({
    data: {
      usuarioId,
      tokenHash: `hash-${sufixo()}`,
      expiraEm: new Date(Date.now() + 1000 * 60 * 60),
    },
    select: { id: true, expiraEm: true, pendenciasDispensadas: true },
  });
}

// obterSessaoAtual real relê o cookie a cada chamada; aqui simulamos isso
// relendo a linha do banco a cada chamada (não guardando um valor fixo em
// memória) — é exatamente esse reflexo em tempo real que faz o fix
// funcionar entre "requisições" diferentes da mesma sessão.
function mockarSessaoAtual(sessaoId: string) {
  vi.mocked(obterSessaoAtual).mockImplementation(async () =>
    prisma.sessao.findUniqueOrThrow({
      where: { id: sessaoId },
      select: { id: true, expiraEm: true, pendenciasDispensadas: true },
    })
  );
}

describe("dispensa de pendência — persistência em Sessao", () => {
  const graficaIdsCriados: string[] = [];

  afterAll(async () => {
    if (graficaIdsCriados.length > 0) {
      await prisma.grafica.deleteMany({ where: { id: { in: graficaIdsCriados } } });
    }
  });

  async function criarFixture() {
    const nome = `Teste pendencia banner ${sufixo()}`;
    const grafica = await prisma.grafica.create({
      data: { nome, slug: nome.toLowerCase().replace(/\s+/g, "-") },
    });
    graficaIdsCriados.push(grafica.id);

    const usuario = await prisma.usuario.create({
      data: {
        graficaId: grafica.id,
        nome: "Dono Teste",
        email: `dono-${sufixo()}@example.com`,
        senhaHash: "hash",
        papel: "DONO",
        emailVerificadoEm: new Date(),
      },
    });

    vi.mocked(obterUsuarioAtual).mockResolvedValue(usuario as never);
    vi.mocked(listarPendenciasConfiguracao).mockResolvedValue([PENDENCIA_FIXA]);

    return { grafica, usuario };
  }

  it(
    "dispensar uma pendência remove ela da MESMA sessão em chamadas seguintes",
    async () => {
      const { usuario } = await criarFixture();
      const sessao = await criarSessaoNoBanco(usuario.id);
      mockarSessaoAtual(sessao.id);

      const antes = await obterPendenciasConfiguracao();
      expect(antes).toHaveLength(1);

      const resultado = await dispensarPendencia(chaveDaPendencia(PENDENCIA_FIXA));
      expect(resultado.ok).toBe(true);

      const depois = await obterPendenciasConfiguracao();
      expect(depois).toHaveLength(0);

      // "nova requisição": obterPendenciasConfiguracao relê tudo do zero
      // (não há cache entre chamadas neste teste) — continua dispensada.
      const outraChamada = await obterPendenciasConfiguracao();
      expect(outraChamada).toHaveLength(0);
    },
    30_000
  );

  it(
    "uma sessão NOVA (próximo login) volta a ver a pendência dispensada na sessão anterior",
    async () => {
      const { usuario } = await criarFixture();
      const sessaoAntiga = await criarSessaoNoBanco(usuario.id);
      mockarSessaoAtual(sessaoAntiga.id);

      await dispensarPendencia(chaveDaPendencia(PENDENCIA_FIXA));
      expect(await obterPendenciasConfiguracao()).toHaveLength(0);

      // Simula logout+login: sessão nova, linha nova, sem nada dispensado.
      const sessaoNova = await criarSessaoNoBanco(usuario.id);
      mockarSessaoAtual(sessaoNova.id);

      const pendenciasNaSessaoNova = await obterPendenciasConfiguracao();
      expect(pendenciasNaSessaoNova).toHaveLength(1);
    },
    30_000
  );

  it("dispensar a mesma chave duas vezes não duplica no array", async () => {
    const { usuario } = await criarFixture();
    const sessao = await criarSessaoNoBanco(usuario.id);
    mockarSessaoAtual(sessao.id);

    const chave = chaveDaPendencia(PENDENCIA_FIXA);
    await dispensarPendencia(chave);
    await dispensarPendencia(chave);

    const linha = await prisma.sessao.findUniqueOrThrow({
      where: { id: sessao.id },
      select: { pendenciasDispensadas: true },
    });
    expect(linha.pendenciasDispensadas).toEqual([chave]);
  });
});
