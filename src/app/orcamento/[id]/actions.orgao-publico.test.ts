import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de integração — achado A12 da Parte 5 da auditoria de abrangência.
// Valida que os campos notaEmpenho e processoLicitatorio podem ser salvos
// e recuperados do orçamento.
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
import { editarDadosGeraisOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function usuarioParaMock(usuarioId: string) {
  return prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
}

type Fixture = {
  graficaId: string;
  usuarioId: string;
  clienteId: string;
  orcamentoId: string;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Órgão Público ${s}`, slug: `teste-orgao-publico-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Usuário ${s}`,
      email: `user-orgao-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente Órgão Público ${s}`, segmento: "ORGAO_PUBLICO" },
  });
  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: cliente.id,
      usuarioId: usuario.id,
      status: "RASCUNHO",
    },
  });

  return { graficaId: grafica.id, usuarioId: usuario.id, clienteId: cliente.id, orcamentoId: orcamento.id };
}

describe("editarDadosGeraisOrcamento — campos órgão público (A12)", () => {
  const graficaIdsParaLimpar: string[] = [];

  afterEach(async () => {
    for (const graficaId of graficaIdsParaLimpar) {
      await prisma.orcamento.deleteMany({ where: { graficaId } });
      await prisma.cliente.deleteMany({ where: { graficaId } });
      await prisma.usuario.deleteMany({ where: { graficaId } });
      await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
      await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
    }
    graficaIdsParaLimpar.length = 0;
    vi.mocked(exigirUsuarioAutenticado).mockReset();
  }, TIMEOUT_MS);

  it(
    "deve salvar notaEmpenho e processoLicitatorio",
    async () => {
      const { graficaId, usuarioId, orcamentoId } = await criarFixture();
      graficaIdsParaLimpar.push(graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(usuarioId)) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({
          orcamentoId,
          notaEmpenho: "NE-2024-0001",
          processoLicitatorio: "PREGAO-2024-0042",
        })
      );

      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findFirst({ where: { id: orcamentoId } });
      expect(orcamento?.notaEmpenho).toBe("NE-2024-0001");
      expect(orcamento?.processoLicitatorio).toBe("PREGAO-2024-0042");
    },
    TIMEOUT_MS
  );

  it(
    "deve permitir salvar apenas notaEmpenho deixando processoLicitatorio vazio",
    async () => {
      const { graficaId, usuarioId, orcamentoId } = await criarFixture();
      graficaIdsParaLimpar.push(graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(usuarioId)) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({
          orcamentoId,
          notaEmpenho: "NE-2024-0002",
          processoLicitatorio: "",
        })
      );

      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findFirst({ where: { id: orcamentoId } });
      expect(orcamento?.notaEmpenho).toBe("NE-2024-0002");
      expect(orcamento?.processoLicitatorio).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "deve permanecer compatível com campos não-órgão-público",
    async () => {
      const { graficaId, usuarioId, orcamentoId } = await criarFixture();
      graficaIdsParaLimpar.push(graficaId);
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await usuarioParaMock(usuarioId)) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({
          orcamentoId,
          vendedor: "João Silva",
          localEntrega: "Rua Principal, 100",
          notaEmpenho: "NE-2024-0003",
        })
      );

      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findFirst({ where: { id: orcamentoId } });
      expect(orcamento?.vendedor).toBe("João Silva");
      expect(orcamento?.localEntrega).toBe("Rua Principal, 100");
      expect(orcamento?.notaEmpenho).toBe("NE-2024-0003");
    },
    TIMEOUT_MS
  );
});
