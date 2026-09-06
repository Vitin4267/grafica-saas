import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.condicao-pagamento-fk.test.ts) — cobre a feature
// "vendedor real no orçamento" (2026-09-06): o seletor de usuário em
// EditarDadosGeraisOrcamentoForm.tsx, persistido via
// Orcamento.vendedorUsuarioId (FK opcional, convive com o texto livre
// `vendedor`) — mesmo princípio de contatoClienteId/condicaoPagamentoId já
// testados ali, MAS com uma trava a mais: só aceita quem está na lista
// fechada de buscarUsuariosVendedores (cargo Vendedor OU DONO/ADMIN), não
// qualquer usuário ativo da gráfica.
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

const graficaIdsParaLimpar: string[] = [];

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function criarFixtureBasica() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Vendedor Usuario FK ${s}`, slug: `teste-vendedor-usuario-fk-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Admin ${s}`,
      email: `admin-vendedor-usuario-fk-${s}@example.com`,
      senhaHash: "x",
      papel: "ADMIN",
    },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "RASCUNHO", total: 100 },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: usuario.id, clienteId: cliente.id, orcamentoId: orcamento.id, sufixo: s };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.perfilUsuario.deleteMany({ where: { usuario: { graficaId } } });
    await prisma.permissaoPerfil.deleteMany({ where: { perfil: { graficaId } } });
    await prisma.perfilAcesso.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("editarDadosGeraisOrcamento — vendedorUsuarioId (feature vendedor real, 2026-09-06)", () => {
  it(
    "salva vendedorUsuarioId + snapshot em vendedor quando um DONO/ADMIN é escolhido (sempre elegível)",
    async () => {
      const f = await criarFixtureBasica();
      const outroAdmin = await prisma.usuario.create({
        data: {
          graficaId: f.graficaId,
          nome: `Vendedor Admin ${f.sufixo}`,
          email: `vendedor-admin-${f.sufixo}@example.com`,
          senhaHash: "x",
          papel: "ADMIN",
        },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({
          orcamentoId: f.orcamentoId,
          vendedorUsuarioId: outroAdmin.id,
          vendedor: outroAdmin.nome,
        })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.vendedorUsuarioId).toBe(outroAdmin.id);
      expect(orcamento.vendedor).toBe(outroAdmin.nome);
    },
    TIMEOUT_MS
  );

  it(
    "salva vendedorUsuarioId quando um OPERADOR com cargo Vendedor é escolhido",
    async () => {
      const f = await criarFixtureBasica();
      const perfilVendedor = await prisma.perfilAcesso.create({
        data: { graficaId: f.graficaId, nome: "Vendedor", funcaoBase: "VENDEDOR" },
      });
      const operadorVendedor = await prisma.usuario.create({
        data: {
          graficaId: f.graficaId,
          nome: `Operador Vendedor ${f.sufixo}`,
          email: `operador-vendedor-${f.sufixo}@example.com`,
          senhaHash: "x",
          papel: "OPERADOR",
        },
      });
      await prisma.perfilUsuario.create({
        data: { usuarioId: operadorVendedor.id, perfilAcessoId: perfilVendedor.id },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, vendedorUsuarioId: operadorVendedor.id })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.vendedorUsuarioId).toBe(operadorVendedor.id);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita um OPERADOR ativo da MESMA gráfica sem cargo Vendedor (não é só tenant — precisa ser elegível)",
    async () => {
      const f = await criarFixtureBasica();
      const operadorComum = await prisma.usuario.create({
        data: {
          graficaId: f.graficaId,
          nome: `Operador Comum ${f.sufixo}`,
          email: `operador-comum-${f.sufixo}@example.com`,
          senhaHash: "x",
          papel: "OPERADOR",
        },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, vendedorUsuarioId: operadorComum.id })
      );
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/vendedor.*inválido/i);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.vendedorUsuarioId).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "vendedorUsuarioId de outra gráfica é rejeitado (isolamento multi-tenant, mesmo princípio de condicaoPagamentoId)",
    async () => {
      const f1 = await criarFixtureBasica();
      const f2 = await criarFixtureBasica();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f1.usuarioId } })) as never
      );

      // f2.usuarioId é ADMIN (sempre elegível na PRÓPRIA gráfica) — mas de
      // outro tenant, então tem que ser rejeitado mesmo assim.
      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({ orcamentoId: f1.orcamentoId, vendedorUsuarioId: f2.usuarioId })
      );
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/vendedor.*inválido/i);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f1.orcamentoId } });
      expect(orcamento.vendedorUsuarioId).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    'vendedorUsuarioId ausente ("", digitação manual): grava null, texto livre continua funcionando',
    async () => {
      const f = await criarFixtureBasica();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, vendedor: "Fulano (sem cadastro)" })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.vendedorUsuarioId).toBeNull();
      expect(orcamento.vendedor).toBe("Fulano (sem cadastro)");
    },
    TIMEOUT_MS
  );
});
