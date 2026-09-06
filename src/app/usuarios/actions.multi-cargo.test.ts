import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/lib/auth/permissoes.test.ts) — cobre a feature
// "multi-cargo" (2026-09-06): criarUsuario aceita cargos múltiplos na
// criação (checkbox em UsuarioForm.tsx) e salvarPerfilUsuario troca o
// conjunto INTEIRO de cargos de um usuário já existente (checkbox em
// PerfilAcessoCell.tsx) — os dois via PerfilUsuario (N:N), nunca duplicando
// linhas nem exigindo um perfilAcessoId único.
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
import { criarUsuario, salvarPerfilUsuario } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

function formDataDe(campos: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) {
    if (Array.isArray(valor)) {
      for (const v of valor) fd.append(chave, v);
    } else {
      fd.set(chave, valor);
    }
  }
  return fd;
}

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Multi Cargo ${s}`, slug: `teste-multi-cargo-${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-multi-cargo-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const perfilVendedor = await prisma.perfilAcesso.create({
    data: { graficaId: grafica.id, nome: "Vendedor", funcaoBase: "VENDEDOR" },
  });
  const perfilFinanceiro = await prisma.perfilAcesso.create({
    data: { graficaId: grafica.id, nome: "Financeiro", funcaoBase: "FINANCEIRO" },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, donoId: dono.id, sufixo: s, perfilVendedor, perfilFinanceiro };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.perfilUsuario.deleteMany({ where: { usuario: { graficaId } } });
    await prisma.permissaoPerfil.deleteMany({ where: { perfil: { graficaId } } });
    await prisma.perfilAcesso.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("criarUsuario — cargos múltiplos na criação (feature multi-cargo, 2026-09-06)", () => {
  it(
    "cria as linhas de PerfilUsuario pros 2 cargos marcados, na mesma transação",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.donoId } })) as never
      );

      const resultado = await criarUsuario(
        null,
        formDataDe({
          nome: `Funcionário Novo ${f.sufixo}`,
          email: `funcionario-novo-${f.sufixo}@example.com`,
          senha: "SenhaForte123",
          papel: "OPERADOR",
          perfilAcessoId: [f.perfilVendedor.id, f.perfilFinanceiro.id],
        })
      );
      expect(resultado.ok).toBe(true);

      const novoUsuario = await prisma.usuario.findFirstOrThrow({
        where: { graficaId: f.graficaId, nome: `Funcionário Novo ${f.sufixo}` },
      });
      const cargos = await prisma.perfilUsuario.findMany({ where: { usuarioId: novoUsuario.id } });
      expect(cargos.map((c) => c.perfilAcessoId).sort()).toEqual(
        [f.perfilVendedor.id, f.perfilFinanceiro.id].sort()
      );
    },
    TIMEOUT_MS
  );

  it(
    "sem nenhum cargo marcado: usuário criado normalmente, sem nenhuma linha de PerfilUsuario",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.donoId } })) as never
      );

      const resultado = await criarUsuario(
        null,
        formDataDe({
          nome: `Funcionário Sem Cargo ${f.sufixo}`,
          email: `funcionario-sem-cargo-${f.sufixo}@example.com`,
          senha: "SenhaForte123",
          papel: "OPERADOR",
        })
      );
      expect(resultado.ok).toBe(true);

      const novoUsuario = await prisma.usuario.findFirstOrThrow({
        where: { graficaId: f.graficaId, nome: `Funcionário Sem Cargo ${f.sufixo}` },
      });
      const cargos = await prisma.perfilUsuario.findMany({ where: { usuarioId: novoUsuario.id } });
      expect(cargos).toHaveLength(0);
    },
    TIMEOUT_MS
  );
});

describe("salvarPerfilUsuario — substitui o conjunto inteiro de cargos (feature multi-cargo, 2026-09-06)", () => {
  it(
    "de 1 cargo pra 2 cargos: adiciona o que faltava sem duplicar o que já existia",
    async () => {
      const f = await criarFixture();
      const operador = await prisma.usuario.create({
        data: {
          graficaId: f.graficaId,
          nome: `Operador ${f.sufixo}`,
          email: `operador-multi-cargo-${f.sufixo}@example.com`,
          senhaHash: "x",
          papel: "OPERADOR",
        },
      });
      await prisma.perfilUsuario.create({
        data: { usuarioId: operador.id, perfilAcessoId: f.perfilVendedor.id },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.donoId } })) as never
      );

      const resultado = await salvarPerfilUsuario(
        null,
        formDataDe({
          usuarioId: operador.id,
          perfilAcessoId: [f.perfilVendedor.id, f.perfilFinanceiro.id],
        })
      );
      expect(resultado.ok).toBe(true);

      const cargos = await prisma.perfilUsuario.findMany({ where: { usuarioId: operador.id } });
      expect(cargos.map((c) => c.perfilAcessoId).sort()).toEqual(
        [f.perfilVendedor.id, f.perfilFinanceiro.id].sort()
      );
    },
    TIMEOUT_MS
  );

  it(
    "de 2 cargos pra 1 cargo: remove o que saiu, sem mexer no que ficou",
    async () => {
      const f = await criarFixture();
      const operador = await prisma.usuario.create({
        data: {
          graficaId: f.graficaId,
          nome: `Operador ${f.sufixo}`,
          email: `operador-multi-cargo-b-${f.sufixo}@example.com`,
          senhaHash: "x",
          papel: "OPERADOR",
        },
      });
      await prisma.perfilUsuario.createMany({
        data: [
          { usuarioId: operador.id, perfilAcessoId: f.perfilVendedor.id },
          { usuarioId: operador.id, perfilAcessoId: f.perfilFinanceiro.id },
        ],
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.donoId } })) as never
      );

      const resultado = await salvarPerfilUsuario(
        null,
        formDataDe({ usuarioId: operador.id, perfilAcessoId: [f.perfilVendedor.id] })
      );
      expect(resultado.ok).toBe(true);

      const cargos = await prisma.perfilUsuario.findMany({ where: { usuarioId: operador.id } });
      expect(cargos.map((c) => c.perfilAcessoId)).toEqual([f.perfilVendedor.id]);
    },
    TIMEOUT_MS
  );

  it(
    "todos os cargos desmarcados: remove todas as linhas, usuário fica sem nenhum cargo",
    async () => {
      const f = await criarFixture();
      const operador = await prisma.usuario.create({
        data: {
          graficaId: f.graficaId,
          nome: `Operador ${f.sufixo}`,
          email: `operador-multi-cargo-c-${f.sufixo}@example.com`,
          senhaHash: "x",
          papel: "OPERADOR",
        },
      });
      await prisma.perfilUsuario.create({
        data: { usuarioId: operador.id, perfilAcessoId: f.perfilVendedor.id },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.donoId } })) as never
      );

      const resultado = await salvarPerfilUsuario(null, formDataDe({ usuarioId: operador.id }));
      expect(resultado.ok).toBe(true);

      const cargos = await prisma.perfilUsuario.findMany({ where: { usuarioId: operador.id } });
      expect(cargos).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "id de perfil de OUTRA gráfica é ignorado silenciosamente (isolamento multi-tenant)",
    async () => {
      const f1 = await criarFixture();
      const f2 = await criarFixture();
      const operador = await prisma.usuario.create({
        data: {
          graficaId: f1.graficaId,
          nome: `Operador ${f1.sufixo}`,
          email: `operador-multi-cargo-d-${f1.sufixo}@example.com`,
          senhaHash: "x",
          papel: "OPERADOR",
        },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f1.donoId } })) as never
      );

      const resultado = await salvarPerfilUsuario(
        null,
        formDataDe({
          usuarioId: operador.id,
          perfilAcessoId: [f1.perfilVendedor.id, f2.perfilVendedor.id],
        })
      );
      expect(resultado.ok).toBe(true);

      const cargos = await prisma.perfilUsuario.findMany({ where: { usuarioId: operador.id } });
      // Só o cargo da MESMA gráfica entrou — o de f2 foi silenciosamente ignorado.
      expect(cargos.map((c) => c.perfilAcessoId)).toEqual([f1.perfilVendedor.id]);
    },
    TIMEOUT_MS
  );
});
