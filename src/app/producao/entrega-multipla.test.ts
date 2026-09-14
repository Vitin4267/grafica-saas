import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de parada-pedido.test.ts/item-pedido-status.test.ts) — cobre
// o achado F2 da auditoria de abrangência (2026-09-14): Entrega deixou de
// ser 1:1 com o Pedido. Foco do teste é o GUARD (nunca mais de uma entrega
// "em voo" ao mesmo tempo), não o resto de criarEntrega/avancarEntrega (RBAC
// e validação básica), que já são exercidos manualmente há tempos sem teste
// dedicado — não ampliado aqui de propósito, fora do escopo do achado.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260914180000_entrega_multipla_por_pedido/migration.sql
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
import { criarEntrega, avancarEntrega } from "./entrega-actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  pedidoId: string;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Entrega Múltipla ${s}`, slug: `teste-entrega-multipla-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-em-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "APROVADO", total: 500 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "EXPEDICAO" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return { graficaId: grafica.id, usuarioDonoId: usuarioDono.id, pedidoId: pedido.id };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function autenticarComo(usuarioId: string) {
  const usuario = await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(usuario as never);
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.entrega.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("criarEntrega — achado F2 (mais de uma entrega por pedido, nunca 2 em voo)", () => {
  it(
    "cria a 1ª entrega normalmente (pedido sem nenhuma ainda)",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      const resultado = await criarEntrega(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(resultado.ok).toBe(true);

      const entregas = await prisma.entrega.findMany({ where: { pedidoId: f.pedidoId } });
      expect(entregas).toHaveLength(1);
      expect(entregas[0].status).toBe("AGUARDANDO");
    },
    TIMEOUT_MS
  );

  it(
    "rejeita a 2ª entrega enquanto a 1ª ainda está AGUARDANDO (em voo)",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      await criarEntrega(null, formDataDe({ pedidoId: f.pedidoId }));
      const segunda = await criarEntrega(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(segunda.ok).toBe(false);

      const entregas = await prisma.entrega.findMany({ where: { pedidoId: f.pedidoId } });
      expect(entregas).toHaveLength(1);
    },
    TIMEOUT_MS
  );

  it(
    "rejeita a 2ª entrega enquanto a 1ª está EM_TRANSITO (ainda em voo)",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      await criarEntrega(null, formDataDe({ pedidoId: f.pedidoId }));
      const primeira = await prisma.entrega.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });
      const avanco = await avancarEntrega(
        null,
        formDataDe({ entregaId: primeira.id, proximoStatus: "EM_TRANSITO" })
      );
      expect(avanco.ok).toBe(true);

      const segunda = await criarEntrega(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(segunda.ok).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "permite a 2ª entrega depois que a 1ª chega a ENTREGUE",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      await criarEntrega(null, formDataDe({ pedidoId: f.pedidoId }));
      const primeira = await prisma.entrega.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });
      await avancarEntrega(null, formDataDe({ entregaId: primeira.id, proximoStatus: "EM_TRANSITO" }));
      await avancarEntrega(null, formDataDe({ entregaId: primeira.id, proximoStatus: "ENTREGUE" }));

      const segunda = await criarEntrega(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(segunda.ok).toBe(true);

      const entregas = await prisma.entrega.findMany({ where: { pedidoId: f.pedidoId } });
      expect(entregas).toHaveLength(2);
    },
    TIMEOUT_MS
  );

  it(
    "permite a 2ª entrega depois que a 1ª vira PROBLEMA (não fica travado nela)",
    async () => {
      const f = await criarFixture();
      await autenticarComo(f.usuarioDonoId);

      await criarEntrega(null, formDataDe({ pedidoId: f.pedidoId }));
      const primeira = await prisma.entrega.findFirstOrThrow({ where: { pedidoId: f.pedidoId } });
      await avancarEntrega(
        null,
        formDataDe({
          entregaId: primeira.id,
          proximoStatus: "PROBLEMA",
          observacoes: "Cliente ausente no endereço.",
        })
      );

      const segunda = await criarEntrega(null, formDataDe({ pedidoId: f.pedidoId }));
      expect(segunda.ok).toBe(true);

      const entregas = await prisma.entrega.findMany({ where: { pedidoId: f.pedidoId }, orderBy: { createdAt: "asc" } });
      expect(entregas).toHaveLength(2);
      expect(entregas[0].status).toBe("PROBLEMA");
      expect(entregas[1].status).toBe("AGUARDANDO");
    },
    TIMEOUT_MS
  );
});
