import { describe, it, expect, afterAll } from "vitest";
import { prisma, transacaoComTenant } from "./prisma";
import { definirTenantAtual, semTenant, comContextoIsolado } from "./tenant-context";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres via DATABASE_URL) pra
// Fase B do isolamento multi-tenant (RLS real no Postgres, achado da
// auditoria de segurança 2026-09-17 — ver plano completo em
// ~/.claude/plans/deep-zooming-parasol.md). SÓ passa de verdade depois que
// a migration prisma/migrations/20260917140000_rls_piloto/migration.sql
// tiver sido aplicada no banco (local: aplicada manualmente após o deploy
// do mecanismo, ver ordem no plano; CI: `prisma migrate deploy` já aplica
// tudo numa base descartável nova a cada run).
//
// Roda como o role restrito de verdade (mesmo em CI, onde
// RLS_TEST_DATABASE_URL aponta pro `ci_app_restrito` criado no workflow —
// só assim RLS tem efeito algum; o `postgres` superuser do CI ignoraria a
// policy). Local, DATABASE_URL já é o role `grafica_app` restrito (achado
// da mesma auditoria), então cai no fallback.
const RLS_DATABASE_URL = process.env.RLS_TEST_DATABASE_URL ?? process.env.DATABASE_URL;

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function criarGraficaComCliente() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste RLS ${s}`, slug: `teste-rls-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente RLS ${s}` },
  });
  return { graficaId: grafica.id, clienteId: cliente.id };
}

const graficasCriadas: string[] = [];

afterAll(async () => {
  for (const graficaId of graficasCriadas) {
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
});

describe("RLS piloto (Cliente) — mecanismo de app (definirTenantAtual + prisma normal)", () => {
  // comContextoIsolado envolve CADA teste inteiro (não só a parte que
  // chama definirTenantAtual) — a criação das fixtures também precisa
  // rodar isolada, senão um contexto vazado de um teste anterior já
  // quebraria o create do Cliente da fixture (ver comentário em
  // comContextoIsolado, tenant-context.ts).
  it("só enxerga o cliente da própria gráfica, nunca o de outra", () =>
    comContextoIsolado(async () => {
      const a = await criarGraficaComCliente();
      const b = await criarGraficaComCliente();
      graficasCriadas.push(a.graficaId, b.graficaId);

      definirTenantAtual(a.graficaId);
      const vistosDeA = await prisma.cliente.findMany({ where: { id: { in: [a.clienteId, b.clienteId] } } });
      expect(vistosDeA.map((c) => c.id)).toEqual([a.clienteId]);

      definirTenantAtual(b.graficaId);
      const vistosDeB = await prisma.cliente.findMany({ where: { id: { in: [a.clienteId, b.clienteId] } } });
      expect(vistosDeB.map((c) => c.id)).toEqual([b.clienteId]);
    }));

  it("semTenant (bypass_rls) enxerga os dois", () =>
    comContextoIsolado(async () => {
      const a = await criarGraficaComCliente();
      const b = await criarGraficaComCliente();
      graficasCriadas.push(a.graficaId, b.graficaId);

      const vistos = await semTenant("teste rls.test.ts — bypass", () =>
        prisma.cliente.findMany({ where: { id: { in: [a.clienteId, b.clienteId] } } })
      );
      expect(vistos.map((c) => c.id).sort()).toEqual([a.clienteId, b.clienteId].sort());
    }));

  it("transacaoComTenant (transação interativa) isola corretamente, sem duplicar o set_config", () =>
    comContextoIsolado(async () => {
      const a = await criarGraficaComCliente();
      const b = await criarGraficaComCliente();
      graficasCriadas.push(a.graficaId, b.graficaId);

      definirTenantAtual(a.graficaId);
      const resultado = await transacaoComTenant(async (tx) => {
        const dentro = await tx.cliente.findMany({ where: { id: { in: [a.clienteId, b.clienteId] } } });
        return dentro.map((c) => c.id);
      });
      expect(resultado).toEqual([a.clienteId]);
    }));
});

// Confirma diretamente contra o Postgres (sem passar pelo mecanismo do
// app) que a policy em si é fail-closed: sem NENHUM app.grafica_id/
// app.bypass_rls setado na conexão, a tabela devolve zero linhas — nunca
// vaza por omissão. Usa $queryRawUnsafe puro, fora do $allOperations do
// app, pra testar a policy isolada do resto do mecanismo.
describe("RLS piloto (Cliente) — policy pura no Postgres, fail-closed por ausência de contexto", () => {
  it("sem set_config nenhum, uma conexão nova não enxerga NENHUMA linha", () =>
    comContextoIsolado(async () => {
      if (!RLS_DATABASE_URL) {
        throw new Error("RLS_TEST_DATABASE_URL/DATABASE_URL ausente — não dá pra rodar este teste.");
      }
      const a = await criarGraficaComCliente();
      graficasCriadas.push(a.graficaId);

      // Conexão nova, isolada do resto do processo — nenhum set_config foi
      // chamado nela ainda, simula exatamente o caso "código esqueceu de
      // estabelecer contexto de tenant".
      const { PrismaPg } = await import("@prisma/adapter-pg");
      const { PrismaClient } = await import("@/generated/prisma/client");
      const adapter = new PrismaPg({ connectionString: RLS_DATABASE_URL });
      const clientCru = new PrismaClient({ adapter });
      try {
        const semContexto = await clientCru.cliente.findMany({ where: { id: a.clienteId } });
        expect(semContexto).toHaveLength(0);
      } finally {
        await clientCru.$disconnect();
      }
    }));
});
