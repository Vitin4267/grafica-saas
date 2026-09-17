import { describe, it, expect, afterAll } from "vitest";
import { criarClient } from "./prisma";
import { definirTenantAtual, semTenant, comContextoIsolado } from "./tenant-context";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres) pra Fase B do
// isolamento multi-tenant (RLS real no Postgres, achado da auditoria de
// segurança 2026-09-17 — ver plano completo em
// ~/.claude/plans/deep-zooming-parasol.md). SÓ passa de verdade depois que
// a migration prisma/migrations/20260917140000_rls_piloto/migration.sql
// tiver sido aplicada no banco (local: aplicada manualmente após o deploy
// do mecanismo, ver ordem no plano; CI: `prisma migrate deploy` já aplica
// tudo numa base descartável nova a cada run).
//
// Client PRÓPRIO (criarClient, não o `prisma` compartilhado do resto do
// app) plugado direto no role restrito — em CI, RLS_TEST_DATABASE_URL
// aponta pro `ci_app_restrito` criado no workflow; local, DATABASE_URL já
// é o role `grafica_app` restrito (achado da mesma auditoria), cai no
// fallback. Deliberadamente SEPARADO do DATABASE_URL usado pelo resto da
// suíte (que continua superuser em CI) — descobri rodando isso de verdade
// que trocar o DATABASE_URL global quebraria ~86 arquivos de fixture que
// criam Cliente/Pedido/etc. sem contexto de tenant (INSERT com RETURNING
// exige a policy de SELECT passar pra devolver a linha criada).
const RLS_DATABASE_URL = process.env.RLS_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const prismaRls = criarClient(RLS_DATABASE_URL);

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// semTenant (não comContextoIsolado sozinho) — criar a fixture é, em si,
// uma operação administrativa cross-tenant (mesma categoria de cron de
// backup), precisa do bypass pra sobreviver ao INSERT+RETURNING exigindo
// a policy de SELECT (ver comentário no migration.sql, item "allow_insert").
async function criarGraficaComCliente() {
  return semTenant("fixture de teste rls.test.ts", async () => {
    const s = sufixo();
    const grafica = await prismaRls.grafica.create({
      data: { nome: `Teste RLS ${s}`, slug: `teste-rls-${s}` },
    });
    const cliente = await prismaRls.cliente.create({
      data: { graficaId: grafica.id, nome: `Cliente RLS ${s}` },
    });
    return { graficaId: grafica.id, clienteId: cliente.id };
  });
}

const graficasCriadas: string[] = [];

afterAll(async () => {
  await semTenant("limpeza dos testes rls.test.ts", async () => {
    for (const graficaId of graficasCriadas) {
      await prismaRls.grafica.delete({ where: { id: graficaId } }).catch(() => {});
    }
  });
  await prismaRls.$disconnect();
});

describe("RLS piloto (Cliente) — mecanismo de app (definirTenantAtual + client restrito)", () => {
  // comContextoIsolado envolve CADA teste inteiro — sem isso o contexto de
  // um teste vaza pro próximo que rodar na mesma worker do Vitest (achado
  // rodando em CI, ver comentário completo em comContextoIsolado,
  // tenant-context.ts).
  it("só enxerga o cliente da própria gráfica, nunca o de outra", () =>
    comContextoIsolado(async () => {
      const a = await criarGraficaComCliente();
      const b = await criarGraficaComCliente();
      graficasCriadas.push(a.graficaId, b.graficaId);

      definirTenantAtual(a.graficaId);
      const vistosDeA = await prismaRls.cliente.findMany({ where: { id: { in: [a.clienteId, b.clienteId] } } });
      expect(vistosDeA.map((c) => c.id)).toEqual([a.clienteId]);

      definirTenantAtual(b.graficaId);
      const vistosDeB = await prismaRls.cliente.findMany({ where: { id: { in: [a.clienteId, b.clienteId] } } });
      expect(vistosDeB.map((c) => c.id)).toEqual([b.clienteId]);
    }));

  it("semTenant (bypass_rls) enxerga os dois", () =>
    comContextoIsolado(async () => {
      const a = await criarGraficaComCliente();
      const b = await criarGraficaComCliente();
      graficasCriadas.push(a.graficaId, b.graficaId);

      // async () => { ...; return await ...; } — NUNCA uma arrow síncrona
      // só repassando a Promise preguiçosa do Prisma sem await interno (ver
      // pegadinha documentada em semTenant, tenant-context.ts — achado
      // depurando este teste falhando em CI, 2026-09-17: sem o await
      // interno, o contexto revertia ANTES da query disparar de verdade).
      const vistos = await semTenant("teste rls.test.ts — bypass", async () => {
        return await prismaRls.cliente.findMany({ where: { id: { in: [a.clienteId, b.clienteId] } } });
      });
      expect(vistos.map((c) => c.id).sort()).toEqual([a.clienteId, b.clienteId].sort());
    }));

  it("transação interativa isola corretamente, sem duplicar o set_config", () =>
    comContextoIsolado(async () => {
      const a = await criarGraficaComCliente();
      const b = await criarGraficaComCliente();
      graficasCriadas.push(a.graficaId, b.graficaId);

      definirTenantAtual(a.graficaId);
      // Replica só o essencial de transacaoComTenant (src/lib/prisma.ts)
      // pra não depender do client `prisma` compartilhado (este arquivo
      // usa prismaRls, um client à parte) — mesma lógica: seta o runtime
      // parameter 1x no início da transação, não a cada statement.
      const resultado = await prismaRls.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.grafica_id', ${a.graficaId}, TRUE)`;
        const dentro = await tx.cliente.findMany({ where: { id: { in: [a.clienteId, b.clienteId] } } });
        return dentro.map((c) => c.id);
      });
      expect(resultado).toEqual([a.clienteId]);
    }));
});

// Confirma diretamente contra o Postgres (client raro, sem NENHUMA
// extensão do app) que a policy em si é fail-closed: sem NENHUM
// app.grafica_id/app.bypass_rls setado na conexão, a tabela devolve zero
// linhas — nunca vaza por omissão.
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
