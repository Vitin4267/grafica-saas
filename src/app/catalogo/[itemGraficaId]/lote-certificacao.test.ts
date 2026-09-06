import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de acabamento-estrutural.test.ts) — cobre o achado F4 da
// Parte 7 da auditoria de abrangência (pesquisa-abrangencia-modulos.md,
// 2026-09-05): "Estoque sem lote/validade — schema já cita exigência que
// não consegue atender".
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260905200000_estoque_lote_validade_certificacao/migration.sql
// tiver sido aplicada no banco (colunas controlaLote/certificacao/
// certificacaoOutro em "itens_grafica" e lote/validade em
// "movimentacoes_estoque" ainda não existem até lá).

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
import { lancarEntradaCompra, salvarLoteCertificacao } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  usuarioOperadorId: string; // sem nenhuma PermissaoUsuario — nunca pode editar
  itemGraficaId: string;
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Lote Certificacao ${s}`, slug: `teste-lote-certificacao-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-lote-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      emailVerificadoEm: new Date(),
    },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-lote-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
      emailVerificadoEm: new Date(),
    },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: {
      graficaId: grafica.id,
      tipo: "MATERIA_PRIMA",
      categoria: "Papel",
      nome: `Couché ${s}`,
      unidade: "FOLHA",
    },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, estoqueAtual: 0 },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    usuarioOperadorId: usuarioOperador.id,
    itemGraficaId: itemGrafica.id,
  };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

async function comoUsuario(usuarioId: string) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(usuario as never);
}

describe("achado F4 — controlaLote é opt-in explícito", () => {
  it(
    "item sem controlaLote (default false): entrada de compra IGNORA lote/validade enviados, mesmo que o form os envie",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("quantidade", "100");
      fd.set("custoUnitario", "1.5");
      // Forjado mesmo sem a UI mostrar o campo — o backend não pode confiar
      // no cliente (ver "tudo sensível no backend").
      fd.set("lote", "L123");
      fd.set("validade", "2027-01-01");

      const resultado = await lancarEntradaCompra(null, fd);
      expect(resultado.ok).toBe(true);

      const mov = await prisma.movimentacaoEstoque.findFirstOrThrow({
        where: { itemGraficaId: f.itemGraficaId, tipo: "ENTRADA_COMPRA" },
      });
      expect(mov.lote).toBeNull();
      expect(mov.validade).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "item COM controlaLote ativo: entrada de compra persiste lote e validade",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fdConfig = new FormData();
      fdConfig.set("itemGraficaId", f.itemGraficaId);
      fdConfig.set("controlaLote", "on");
      const configResultado = await salvarLoteCertificacao(null, fdConfig);
      expect(configResultado.ok).toBe(true);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("quantidade", "100");
      fd.set("custoUnitario", "1.5");
      fd.set("lote", "L123");
      fd.set("validade", "2027-01-01");

      const resultado = await lancarEntradaCompra(null, fd);
      expect(resultado.ok).toBe(true);

      const mov = await prisma.movimentacaoEstoque.findFirstOrThrow({
        where: { itemGraficaId: f.itemGraficaId, tipo: "ENTRADA_COMPRA" },
      });
      expect(mov.lote).toBe("L123");
      expect(mov.validade?.toISOString().slice(0, 10)).toBe("2027-01-01");
    },
    TIMEOUT_MS
  );

  it(
    "item COM controlaLote ativo: entrada de compra SEM lote/validade preenchidos continua funcionando (opcional mesmo ativado)",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fdConfig = new FormData();
      fdConfig.set("itemGraficaId", f.itemGraficaId);
      fdConfig.set("controlaLote", "on");
      await salvarLoteCertificacao(null, fdConfig);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("quantidade", "50");
      fd.set("custoUnitario", "2");

      const resultado = await lancarEntradaCompra(null, fd);
      expect(resultado.ok).toBe(true);

      const mov = await prisma.movimentacaoEstoque.findFirstOrThrow({
        where: { itemGraficaId: f.itemGraficaId, tipo: "ENTRADA_COMPRA" },
      });
      expect(mov.lote).toBeNull();
      expect(mov.validade).toBeNull();
    },
    TIMEOUT_MS
  );
});

describe("achado F4 — salvarLoteCertificacao", () => {
  it(
    "certificacao=OUTRO grava o texto livre em certificacaoOutro",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("certificacao", "OUTRO");
      fd.set("certificacaoOutro", "Selo próprio da gráfica");

      const resultado = await salvarLoteCertificacao(null, fd);
      expect(resultado.ok).toBe(true);

      const item = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(item.certificacao).toBe("OUTRO");
      expect(item.certificacaoOutro).toBe("Selo próprio da gráfica");
      expect(item.controlaLote).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "certificacao fechada (FSC) não grava certificacaoOutro",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("certificacao", "FSC");

      const resultado = await salvarLoteCertificacao(null, fd);
      expect(resultado.ok).toBe(true);

      const item = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(item.certificacao).toBe("FSC");
      expect(item.certificacaoOutro).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "isolamento de tenant: item de OUTRA gráfica é rejeitado",
    async () => {
      const f = await criarFixture();
      const outraFixture = await criarFixture();
      await comoUsuario(f.usuarioDonoId);

      const fd = new FormData();
      fd.set("itemGraficaId", outraFixture.itemGraficaId);
      fd.set("controlaLote", "on");

      const resultado = await salvarLoteCertificacao(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não encontrado/i);

      const itemOutraGrafica = await prisma.itemGrafica.findUniqueOrThrow({
        where: { id: outraFixture.itemGraficaId },
      });
      expect(itemOutraGrafica.controlaLote).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "RBAC — OPERADOR sem permissão de CATALOGO não consegue ativar controlaLote",
    async () => {
      const f = await criarFixture();
      await comoUsuario(f.usuarioOperadorId);

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("controlaLote", "on");

      const resultado = await salvarLoteCertificacao(null, fd);
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/não tem permissão/i);

      const item = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(item.controlaLote).toBe(false);
    },
    TIMEOUT_MS
  );
});
