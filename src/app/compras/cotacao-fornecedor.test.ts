import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { avancarStatusCompra, type SolicitacaoParaTransicao } from "./status-transicao";
import type { StatusSolicitacaoCompra } from "@/lib/compras-status";

// avancarStatusCompra chama revalidatePath no final — fora de uma requisição
// Next.js de verdade (é o caso deste teste de integração, que chama a
// função direto) isso derruba com "static generation store missing". Mesmo
// mock de status-transicao.custo-automatico.test.ts.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de status-transicao.custo-automatico.test.ts) — cobre o
// achado A4 da auditoria de abrangência (Parte 3/Compras): o status COTANDO
// não guardava nenhuma cotação de verdade, só um único fornecedorId+
// valorEstimado. Chama avancarStatusCompra direto (não as server actions em
// actions.ts, que exigem cookies via exigirUsuarioAutenticado fora de uma
// requisição de verdade) e escreve CotacaoFornecedor direto via Prisma —
// exatamente o que registrarCotacaoFornecedor/definirCotacaoVencedora fazem
// depois de validar entrada/permissão.
const TIMEOUT_MS = 30_000;

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioId: string;
  fornecedorAId: string;
  fornecedorBId: string;
  itemGraficaId: string;
  solicitacaoId: string;
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(opts?: { statusInicial?: StatusSolicitacaoCompra }): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Cotacao ${s}`, slug: `teste-cotacao-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-cotacao-${s}@example.com`, senhaHash: "x" },
  });
  const fornecedorA = await prisma.fornecedor.create({ data: { graficaId: grafica.id, nome: `Suzano ${s}` } });
  const fornecedorB = await prisma.fornecedor.create({ data: { graficaId: grafica.id, nome: `Ibema ${s}` } });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, estoqueAtual: 0 },
  });
  const solicitacao = await prisma.solicitacaoCompra.create({
    data: {
      graficaId: grafica.id,
      itemGraficaId: itemGrafica.id,
      quantidade: 100,
      status: opts?.statusInicial ?? "COTANDO",
      usuarioSolicitanteId: usuario.id,
    },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioId: usuario.id,
    fornecedorAId: fornecedorA.id,
    fornecedorBId: fornecedorB.id,
    itemGraficaId: itemGrafica.id,
    solicitacaoId: solicitacao.id,
  };
}

// Monta o SolicitacaoParaTransicao lendo o estado ATUAL do banco — mesma
// necessidade de status-transicao.custo-automatico.test.ts: o CAS de
// avancarStatusCompra exige que o `status` passado bata com o que está
// gravado.
async function solicitacaoParaTransicao(solicitacaoId: string): Promise<SolicitacaoParaTransicao> {
  const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacaoId } });
  return {
    id: solicitacao.id,
    graficaId: solicitacao.graficaId,
    status: solicitacao.status,
    itemGraficaId: solicitacao.itemGraficaId,
    varianteId: solicitacao.varianteId,
    quantidade: solicitacao.quantidade,
    valorFinal: solicitacao.valorFinal,
    fornecedorId: solicitacao.fornecedorId,
    documento: solicitacao.documento,
    pedidoId: solicitacao.pedidoId,
  };
}

// Ordem de exclusão respeitando as FKs do schema — CotacaoFornecedor
// primeiro (Cascade em solicitacaoCompraId/fornecedorId, mas Restrict em
// registradaPorId contra Usuario, então precisa sumir antes de apagar o
// usuário).
afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.cotacaoFornecedor.deleteMany({ where: { solicitacaoCompra: { graficaId } } });
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.solicitacaoCompra.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.fornecedor.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("CotacaoFornecedor — mapa de cotação (achado A4 da auditoria de abrangência)", () => {
  it(
    "registra cotação de dois fornecedores pra uma mesma solicitação, e recotar o mesmo fornecedor atualiza em vez de duplicar",
    async () => {
      const f = await criarFixture();

      await prisma.cotacaoFornecedor.create({
        data: {
          solicitacaoCompraId: f.solicitacaoId,
          fornecedorId: f.fornecedorAId,
          precoUnitario: 5.2,
          valorTotal: 520,
          prazoEntregaDias: 10,
          condicaoPagamento: "boleto 30",
          registradaPorId: f.usuarioId,
        },
      });
      await prisma.cotacaoFornecedor.create({
        data: {
          solicitacaoCompraId: f.solicitacaoId,
          fornecedorId: f.fornecedorBId,
          precoUnitario: 5.45,
          valorTotal: 545,
          prazoEntregaDias: 3,
          condicaoPagamento: "à vista",
          registradaPorId: f.usuarioId,
        },
      });

      const cotacoes = await prisma.cotacaoFornecedor.findMany({ where: { solicitacaoCompraId: f.solicitacaoId } });
      expect(cotacoes).toHaveLength(2);

      // Recota o fornecedor A com preço diferente — @@unique([solicitacaoCompraId,
      // fornecedorId]) garante que isto é um upsert, nunca uma terceira linha
      // (mesmo comportamento de registrarCotacaoFornecedor em actions.ts).
      await prisma.cotacaoFornecedor.upsert({
        where: { solicitacaoCompraId_fornecedorId: { solicitacaoCompraId: f.solicitacaoId, fornecedorId: f.fornecedorAId } },
        create: {
          solicitacaoCompraId: f.solicitacaoId,
          fornecedorId: f.fornecedorAId,
          precoUnitario: 4.9,
          valorTotal: 490,
          registradaPorId: f.usuarioId,
        },
        update: { precoUnitario: 4.9, valorTotal: 490 },
      });

      const cotacoesDepois = await prisma.cotacaoFornecedor.findMany({
        where: { solicitacaoCompraId: f.solicitacaoId },
        orderBy: { precoUnitario: "asc" },
      });
      expect(cotacoesDepois).toHaveLength(2); // continua 2, não virou 3
      expect(Number(cotacoesDepois[0].precoUnitario)).toBe(4.9); // preço recotado
    },
    TIMEOUT_MS
  );

  it(
    "marcar uma cotação vencedora desmarca qualquer outra da mesma solicitação — nunca duas ao mesmo tempo",
    async () => {
      const f = await criarFixture();
      const cotacaoA = await prisma.cotacaoFornecedor.create({
        data: { solicitacaoCompraId: f.solicitacaoId, fornecedorId: f.fornecedorAId, precoUnitario: 5.2, valorTotal: 520, registradaPorId: f.usuarioId },
      });
      const cotacaoB = await prisma.cotacaoFornecedor.create({
        data: { solicitacaoCompraId: f.solicitacaoId, fornecedorId: f.fornecedorBId, precoUnitario: 5.45, valorTotal: 545, registradaPorId: f.usuarioId },
      });

      // Mesma transação de definirCotacaoVencedora em actions.ts.
      await prisma.$transaction([
        prisma.cotacaoFornecedor.updateMany({
          where: { solicitacaoCompraId: f.solicitacaoId, id: { not: cotacaoA.id } },
          data: { vencedora: false },
        }),
        prisma.cotacaoFornecedor.update({ where: { id: cotacaoA.id }, data: { vencedora: true } }),
      ]);

      let vencedoras = await prisma.cotacaoFornecedor.findMany({
        where: { solicitacaoCompraId: f.solicitacaoId, vencedora: true },
      });
      expect(vencedoras).toHaveLength(1);
      expect(vencedoras[0].id).toBe(cotacaoA.id);

      // Trocar a vencedora pra B — A precisa voltar a false.
      await prisma.$transaction([
        prisma.cotacaoFornecedor.updateMany({
          where: { solicitacaoCompraId: f.solicitacaoId, id: { not: cotacaoB.id } },
          data: { vencedora: false },
        }),
        prisma.cotacaoFornecedor.update({ where: { id: cotacaoB.id }, data: { vencedora: true } }),
      ]);

      vencedoras = await prisma.cotacaoFornecedor.findMany({
        where: { solicitacaoCompraId: f.solicitacaoId, vencedora: true },
      });
      expect(vencedoras).toHaveLength(1);
      expect(vencedoras[0].id).toBe(cotacaoB.id);
    },
    TIMEOUT_MS
  );

  it(
    "COTANDO→APROVADO rejeita sem cotação vencedora escolhida",
    async () => {
      const f = await criarFixture({ statusInicial: "COTANDO" });
      await prisma.cotacaoFornecedor.create({
        data: { solicitacaoCompraId: f.solicitacaoId, fornecedorId: f.fornecedorAId, precoUnitario: 5.2, valorTotal: 520, registradaPorId: f.usuarioId },
      });
      await prisma.cotacaoFornecedor.create({
        data: { solicitacaoCompraId: f.solicitacaoId, fornecedorId: f.fornecedorBId, precoUnitario: 5.45, valorTotal: 545, registradaPorId: f.usuarioId },
      });
      // Nenhuma marcada vencedora=true de propósito.

      const solicitacao = await solicitacaoParaTransicao(f.solicitacaoId);
      const resultado = await avancarStatusCompra(solicitacao, "APROVADO", { id: f.usuarioId });

      expect(resultado.ok).toBe(false);
      if (!resultado.ok) {
        expect(resultado.mensagem).toMatch(/escolha a cota[cç][aã]o vencedora/i);
      }

      const solicitacaoDepois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: f.solicitacaoId } });
      expect(solicitacaoDepois.status).toBe("COTANDO"); // não avançou
    },
    TIMEOUT_MS
  );

  it(
    "COTANDO→APROVADO com vencedora escolhida copia fornecedorId e valorEstimado da cotação pra solicitação",
    async () => {
      const f = await criarFixture({ statusInicial: "COTANDO" });
      await prisma.cotacaoFornecedor.create({
        data: { solicitacaoCompraId: f.solicitacaoId, fornecedorId: f.fornecedorAId, precoUnitario: 5.2, valorTotal: 520, registradaPorId: f.usuarioId },
      });
      const cotacaoVencedora = await prisma.cotacaoFornecedor.create({
        data: {
          solicitacaoCompraId: f.solicitacaoId,
          fornecedorId: f.fornecedorBId,
          precoUnitario: 5.45,
          valorTotal: 545,
          vencedora: true,
          registradaPorId: f.usuarioId,
        },
      });

      const solicitacao = await solicitacaoParaTransicao(f.solicitacaoId);
      const resultado = await avancarStatusCompra(solicitacao, "APROVADO", { id: f.usuarioId });

      expect(resultado.ok).toBe(true);

      const solicitacaoDepois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: f.solicitacaoId } });
      expect(solicitacaoDepois.status).toBe("APROVADO");
      expect(solicitacaoDepois.fornecedorId).toBe(f.fornecedorBId); // fornecedor da vencedora, não da outra
      expect(Number(solicitacaoDepois.valorEstimado)).toBeCloseTo(Number(cotacaoVencedora.valorTotal), 2);
      expect(solicitacaoDepois.aprovadoEm).not.toBeNull();
      expect(solicitacaoDepois.usuarioAprovadorId).toBe(f.usuarioId);
    },
    TIMEOUT_MS
  );

  it(
    "cotação vencedora manda mesmo se o form enviar um fornecedorId manual diferente",
    async () => {
      const f = await criarFixture({ statusInicial: "COTANDO" });
      await prisma.cotacaoFornecedor.create({
        data: {
          solicitacaoCompraId: f.solicitacaoId,
          fornecedorId: f.fornecedorAId,
          precoUnitario: 5.2,
          valorTotal: 520,
          vencedora: true,
          registradaPorId: f.usuarioId,
        },
      });

      const solicitacao = await solicitacaoParaTransicao(f.solicitacaoId);
      // Simula alguém tentando forçar o fornecedor B pelo campo manual do
      // formulário de APROVADO — a vencedora (fornecedor A) deve prevalecer.
      const resultado = await avancarStatusCompra(solicitacao, "APROVADO", { id: f.usuarioId }, {
        fornecedorId: f.fornecedorBId,
      });

      expect(resultado.ok).toBe(true);
      const solicitacaoDepois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: f.solicitacaoId } });
      expect(solicitacaoDepois.fornecedorId).toBe(f.fornecedorAId);
    },
    TIMEOUT_MS
  );

  it(
    "SOLICITADO→APROVADO direto (pulando cotação) continua funcionando sem exigir vencedora — comportamento aditivo",
    async () => {
      const f = await criarFixture({ statusInicial: "SOLICITADO" });
      // Nenhuma CotacaoFornecedor criada — replica exatamente o fluxo de
      // antes deste achado.

      const solicitacao = await solicitacaoParaTransicao(f.solicitacaoId);
      const resultado = await avancarStatusCompra(solicitacao, "APROVADO", { id: f.usuarioId }, {
        fornecedorId: f.fornecedorAId,
      });

      expect(resultado.ok).toBe(true);
      const solicitacaoDepois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: f.solicitacaoId } });
      expect(solicitacaoDepois.status).toBe("APROVADO");
      expect(solicitacaoDepois.fornecedorId).toBe(f.fornecedorAId); // veio do campo manual, não de cotação
    },
    TIMEOUT_MS
  );
});
