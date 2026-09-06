import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.frete-transportadora.test.ts) — cobre o gap de UI
// do achado A7 da Parte 4 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md): o seletor de CondicaoPagamento em
// EditarDadosGeraisOrcamentoForm.tsx, persistido via
// Orcamento.condicaoPagamentoId (FK opcional, convive com o texto livre
// `condicoesPagamento`) — mesmo princípio de contatoClienteId/
// transportadoraId já testados ali.
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
    data: { nome: `Teste Condicao Pagamento FK ${s}`, slug: `teste-condicao-pagamento-fk-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Admin ${s}`,
      email: `admin-condicao-pagamento-fk-${s}@example.com`,
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
  return { graficaId: grafica.id, usuarioId: usuario.id, clienteId: cliente.id, orcamentoId: orcamento.id };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.condicaoPagamentoParcela.deleteMany({ where: { condicaoPagamento: { graficaId } } });
    await prisma.condicaoPagamento.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("editarDadosGeraisOrcamento — condicaoPagamentoId (achado A7 da Parte 4)", () => {
  it(
    "salva condicaoPagamentoId + snapshot em condicoesPagamento quando uma CondicaoPagamento cadastrada é escolhida",
    async () => {
      const f = await criarFixtureBasica();
      const condicao = await prisma.condicaoPagamento.create({
        data: {
          graficaId: f.graficaId,
          nome: "30/60/90 com 2% de acréscimo",
          ancora: "APROVACAO",
          acrescimoPercent: 2,
          parcelas: {
            create: [
              { ordem: 1, percentual: 33.34, diasAposAncora: 30 },
              { ordem: 2, percentual: 33.33, diasAposAncora: 60 },
              { ordem: 3, percentual: 33.33, diasAposAncora: 90 },
            ],
          },
        },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({
          orcamentoId: f.orcamentoId,
          condicaoPagamentoId: condicao.id,
          condicoesPagamento: condicao.nome,
        })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.condicaoPagamentoId).toBe(condicao.id);
      expect(orcamento.condicoesPagamento).toBe(condicao.nome);
    },
    TIMEOUT_MS
  );

  it(
    'condicaoPagamentoId ausente ("", digitação manual): grava null, texto livre continua funcionando',
    async () => {
      const f = await criarFixtureBasica();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, condicoesPagamento: "28/35ddl (sem cadastro)" })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.condicaoPagamentoId).toBeNull();
      expect(orcamento.condicoesPagamento).toBe("28/35ddl (sem cadastro)");
    },
    TIMEOUT_MS
  );

  it(
    "condicaoPagamentoId de outra gráfica é rejeitado (isolamento multi-tenant, mesmo princípio de transportadoraId)",
    async () => {
      const f1 = await criarFixtureBasica();
      const f2 = await criarFixtureBasica();
      const condicaoDeF2 = await prisma.condicaoPagamento.create({
        data: {
          graficaId: f2.graficaId,
          nome: "Condição da Outra Gráfica",
          ancora: "APROVACAO",
          parcelas: { create: [{ ordem: 1, percentual: 100, diasAposAncora: 0 }] },
        },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f1.usuarioId } })) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({ orcamentoId: f1.orcamentoId, condicaoPagamentoId: condicaoDeF2.id })
      );
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/condição de pagamento.*inválida/i);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f1.orcamentoId } });
      expect(orcamento.condicaoPagamentoId).toBeNull();
    },
    TIMEOUT_MS
  );
});
