import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/orcamento/[id]/actions.vendedor-cliente.test.ts) —
// cobre o achado F3 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, Parte 7): CRUD de Transportadora, mesmo
// formato de src/app/configuracoes/fornecedores/actions.ts.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
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
import { criarTransportadora, editarTransportadora, alternarAtivaTransportadora } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = { graficaId: string; usuarioId: string };

// ADMIN (não OPERADOR): OPERADOR exige PermissaoUsuario.CONFIGURACOES.podeEditar
// explícita (ver podeEditarModulo em src/lib/auth/permissoes.ts), que este
// fixture não cria — mesmo padrão de actions.vendedor-cliente.test.ts.
async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Transportadora ${s}`, slug: `teste-transportadora-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Admin ${s}`,
      email: `admin-transportadora-${s}@example.com`,
      senhaHash: "x",
      papel: "ADMIN",
    },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: usuario.id };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.transportadora.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

async function autenticarComo(usuarioId: string) {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
    (await prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      include: { grafica: true },
    })) as never
  );
}

describe("CRUD de Transportadora (achado F3)", () => {
  it(
    "criarTransportadora: cria com nome + telefone/email opcionais",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioId);

      await expect(
        criarTransportadora(
          null,
          formDataDe({ nome: "Lalamove", telefone: "(11) 91234-5678", email: "contato@lalamove.com" })
        )
      ).rejects.toThrow(/^REDIRECT:/); // redirect() lança — mesmo padrão de criarFornecedor

      const transportadora = await prisma.transportadora.findFirstOrThrow({
        where: { graficaId: f.graficaId, nome: "Lalamove" },
      });
      expect(transportadora.telefone).toBe("(11) 91234-5678");
      expect(transportadora.email).toBe("contato@lalamove.com");
      expect(transportadora.ativa).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "criarTransportadora: nome vazio é rejeitado",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioId);

      const resultado = await criarTransportadora(null, formDataDe({ nome: "" }));
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/nome/i);
    },
    TIMEOUT_MS
  );

  it(
    "criarTransportadora: nome duplicado na mesma gráfica é rejeitado",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioId);
      await prisma.transportadora.create({
        data: { graficaId: f.graficaId, nome: "Jadlog" },
      });

      const resultado = await criarTransportadora(null, formDataDe({ nome: "Jadlog" }));
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/já existe/i);
    },
    TIMEOUT_MS
  );

  it(
    "editarTransportadora: atualiza nome, contato, documento e RNTRC",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioId);
      const transportadora = await prisma.transportadora.create({
        data: { graficaId: f.graficaId, nome: "Transp Original" },
      });

      const resultado = await editarTransportadora(
        null,
        formDataDe({
          transportadoraId: transportadora.id,
          nome: "Transp Renomeada",
          telefone: "(11) 98888-7777",
          email: "novo@transp.com",
          documento: "12.345.678/0001-99",
          rntrc: "RNTRC-123",
        })
      );
      expect(resultado.ok).toBe(true);

      const atualizada = await prisma.transportadora.findUniqueOrThrow({ where: { id: transportadora.id } });
      expect(atualizada.nome).toBe("Transp Renomeada");
      expect(atualizada.telefone).toBe("(11) 98888-7777");
      expect(atualizada.documento).toBe("12.345.678/0001-99");
      expect(atualizada.rntrc).toBe("RNTRC-123");
    },
    TIMEOUT_MS
  );

  it(
    "editarTransportadora: transportadora de outra gráfica não é encontrada (isolamento multi-tenant)",
    async () => {
      const f1 = await criarFixture();
      const f2 = await criarFixture();
      const transportadoraDeF2 = await prisma.transportadora.create({
        data: { graficaId: f2.graficaId, nome: "Transp da Outra Grafica" },
      });
      await autenticarComo(f1.usuarioId);

      const resultado = await editarTransportadora(
        null,
        formDataDe({ transportadoraId: transportadoraDeF2.id, nome: "Tentativa de invasão" })
      );
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não encontrada/i);
    },
    TIMEOUT_MS
  );

  it(
    "alternarAtivaTransportadora: alterna ativa->inativa->ativa, nunca faz delete físico",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioId);
      const transportadora = await prisma.transportadora.create({
        data: { graficaId: f.graficaId, nome: "Transp Toggle" },
      });
      expect(transportadora.ativa).toBe(true);

      const resultado1 = await alternarAtivaTransportadora(
        null,
        formDataDe({ transportadoraId: transportadora.id })
      );
      expect(resultado1.ok).toBe(true);
      const desativada = await prisma.transportadora.findUniqueOrThrow({ where: { id: transportadora.id } });
      expect(desativada.ativa).toBe(false);

      const resultado2 = await alternarAtivaTransportadora(
        null,
        formDataDe({ transportadoraId: transportadora.id })
      );
      expect(resultado2.ok).toBe(true);
      const reativada = await prisma.transportadora.findUniqueOrThrow({ where: { id: transportadora.id } });
      expect(reativada.ativa).toBe(true);
    },
    TIMEOUT_MS
  );
});
