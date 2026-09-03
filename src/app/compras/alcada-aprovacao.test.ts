import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusCompra, type SolicitacaoParaTransicao } from "./status-transicao";

// avancarStatusCompra chama revalidatePath no final — fora de uma requisição
// Next.js de verdade isso derruba com "static generation store missing".
// Mesmo mock de cotacao-fornecedor.test.ts.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de cotacao-fornecedor.test.ts) — cobre o achado A4 da
// auditoria de abrangência (Parte 6/Configurações,
// pesquisa-abrangencia-modulos.md, 2026-09-02): trava de ALÇADA por valor
// na aprovação de SolicitacaoCompra (src/app/compras/status-transicao.ts).
// Chama avancarStatusCompra direto, mesma razão de cotacao-fornecedor.test.ts
// (exigirUsuarioAutenticado precisa de cookies de uma requisição real).
const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioOperadorId: string;
  usuarioOperadorChefeId: string;
  usuarioDonoId: string;
  itemGraficaId: string;
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Alcada Compra ${s}`, slug: `teste-alcada-compra-${s}` },
  });
  const usuarioOperador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador ${s}`,
      email: `operador-alcada-compra-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  const usuarioOperadorChefe = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Operador Chefe ${s}`,
      email: `operador-chefe-alcada-compra-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
    },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-alcada-compra-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, estoqueAtual: 0 },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioOperadorId: usuarioOperador.id,
    usuarioOperadorChefeId: usuarioOperadorChefe.id,
    usuarioDonoId: usuarioDono.id,
    itemGraficaId: itemGrafica.id,
  };
}

async function criarSolicitacao(
  fixture: Fixture,
  opts: { valorEstimado?: number; usuarioSolicitanteId?: string } = {}
) {
  return prisma.solicitacaoCompra.create({
    data: {
      graficaId: fixture.graficaId,
      itemGraficaId: fixture.itemGraficaId,
      quantidade: 10,
      valorEstimado: opts.valorEstimado !== undefined ? opts.valorEstimado.toFixed(2) : null,
      status: "SOLICITADO",
      usuarioSolicitanteId: opts.usuarioSolicitanteId ?? fixture.usuarioOperadorId,
    },
  });
}

async function solicitacaoParaTransicao(solicitacaoId: string): Promise<SolicitacaoParaTransicao> {
  const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacaoId } });
  return {
    id: solicitacao.id,
    graficaId: solicitacao.graficaId,
    status: solicitacao.status,
    itemGraficaId: solicitacao.itemGraficaId,
    varianteId: solicitacao.varianteId,
    quantidade: solicitacao.quantidade,
    valorEstimado: solicitacao.valorEstimado,
    valorFinal: solicitacao.valorFinal,
    fornecedorId: solicitacao.fornecedorId,
    documento: solicitacao.documento,
    pedidoId: solicitacao.pedidoId,
    contratoFornecimentoId: solicitacao.contratoFornecimentoId,
  };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.alcadaAprovacao.deleteMany({ where: { graficaId } });
    await prisma.solicitacaoCompra.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("avancarStatusCompra — alçada de aprovação por valor (achado A4)", () => {
  it(
    "sem NENHUMA alçada configurada, OPERADOR aprova um valor alto sem bloqueio — regressão zero (comportamento de sempre: sem teto)",
    async () => {
      const fixture = await criarFixture();
      const solicitacao = await criarSolicitacao(fixture, { valorEstimado: 50000 });

      const resultado = await avancarStatusCompra(
        await solicitacaoParaTransicao(solicitacao.id),
        "APROVADO",
        { id: fixture.usuarioOperadorId, papel: "OPERADOR" }
      );

      expect(resultado.ok).toBe(true);
      const depois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacao.id } });
      expect(depois.status).toBe("APROVADO");
      expect(depois.usuarioAprovadorId).toBe(fixture.usuarioOperadorId);
    },
    TIMEOUT_MS
  );

  it(
    "alçada de PAPEL bloqueia OPERADOR tentando aprovar acima do próprio teto",
    async () => {
      const fixture = await criarFixture();
      await prisma.alcadaAprovacao.create({
        data: { graficaId: fixture.graficaId, tipo: "APROVACAO_COMPRA", papel: "OPERADOR", limite: 1000 },
      });
      const solicitacao = await criarSolicitacao(fixture, { valorEstimado: 5000 });

      const resultado = await avancarStatusCompra(
        await solicitacaoParaTransicao(solicitacao.id),
        "APROVADO",
        { id: fixture.usuarioOperadorId, papel: "OPERADOR" }
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("alçada");
      const depois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacao.id } });
      expect(depois.status).toBe("SOLICITADO"); // nada mudou
    },
    TIMEOUT_MS
  );

  it(
    "alçada de PAPEL libera OPERADOR dentro do próprio teto",
    async () => {
      const fixture = await criarFixture();
      await prisma.alcadaAprovacao.create({
        data: { graficaId: fixture.graficaId, tipo: "APROVACAO_COMPRA", papel: "OPERADOR", limite: 1000 },
      });
      const solicitacao = await criarSolicitacao(fixture, { valorEstimado: 800 });

      const resultado = await avancarStatusCompra(
        await solicitacaoParaTransicao(solicitacao.id),
        "APROVADO",
        { id: fixture.usuarioOperadorId, papel: "OPERADOR" }
      );

      expect(resultado.ok).toBe(true);
      const depois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacao.id } });
      expect(depois.status).toBe("APROVADO");
    },
    TIMEOUT_MS
  );

  it(
    "alçada de USUÁRIO específico tem prioridade sobre a alçada do PAPEL — operador chefe aprova mais que o resto do papel",
    async () => {
      const fixture = await criarFixture();
      await prisma.alcadaAprovacao.createMany({
        data: [
          { graficaId: fixture.graficaId, tipo: "APROVACAO_COMPRA", papel: "OPERADOR", limite: 1000 },
          {
            graficaId: fixture.graficaId,
            tipo: "APROVACAO_COMPRA",
            usuarioId: fixture.usuarioOperadorChefeId,
            limite: 10000,
          },
        ],
      });

      // Operador comum (só a alçada do papel) continua travado em 1000.
      const solicitacaoComum = await criarSolicitacao(fixture, { valorEstimado: 5000 });
      const resultadoComum = await avancarStatusCompra(
        await solicitacaoParaTransicao(solicitacaoComum.id),
        "APROVADO",
        { id: fixture.usuarioOperadorId, papel: "OPERADOR" }
      );
      expect(resultadoComum.ok).toBe(false);

      // Operador CHEFE (alçada própria de 10000) aprova o mesmo valor sem bloqueio.
      const solicitacaoChefe = await criarSolicitacao(fixture, { valorEstimado: 5000 });
      const resultadoChefe = await avancarStatusCompra(
        await solicitacaoParaTransicao(solicitacaoChefe.id),
        "APROVADO",
        { id: fixture.usuarioOperadorChefeId, papel: "OPERADOR" }
      );
      expect(resultadoChefe.ok).toBe(true);
      const depois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacaoChefe.id } });
      expect(depois.status).toBe("APROVADO");
    },
    TIMEOUT_MS
  );

  it(
    "sem valorEstimado nenhum (SOLICITADO→APROVADO direto, sem cotação nem valor informado), nada pra checar — segue sem bloquear",
    async () => {
      const fixture = await criarFixture();
      await prisma.alcadaAprovacao.create({
        data: { graficaId: fixture.graficaId, tipo: "APROVACAO_COMPRA", papel: "OPERADOR", limite: 1000 },
      });
      const solicitacao = await criarSolicitacao(fixture); // sem valorEstimado

      const resultado = await avancarStatusCompra(
        await solicitacaoParaTransicao(solicitacao.id),
        "APROVADO",
        { id: fixture.usuarioOperadorId, papel: "OPERADOR" }
      );

      expect(resultado.ok).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "papel não informado ao chamador (compat com chamadores antigos) resolve o papel do banco e aplica a alçada normalmente",
    async () => {
      const fixture = await criarFixture();
      await prisma.alcadaAprovacao.create({
        data: { graficaId: fixture.graficaId, tipo: "APROVACAO_COMPRA", papel: "OPERADOR", limite: 1000 },
      });
      const solicitacao = await criarSolicitacao(fixture, { valorEstimado: 5000 });

      // Só { id }, sem papel — mesmo formato que os testes de
      // cotacao-fornecedor.test.ts/origem-solicitacao-compra.test.ts já usam.
      const resultado = await avancarStatusCompra(
        await solicitacaoParaTransicao(solicitacao.id),
        "APROVADO",
        { id: fixture.usuarioOperadorId }
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("alçada");
    },
    TIMEOUT_MS
  );
});
