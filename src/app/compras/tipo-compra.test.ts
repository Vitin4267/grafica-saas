import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/compras/origem-solicitacao-compra.test.ts) — cobre
// o achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06):
// antes desta feature, SolicitacaoCompra.itemGraficaId era obrigatório e só
// aceitava item do catálogo com itemCatalogo.tipo=MATERIA_PRIMA —
// impossível registrar compra de serviço terceirizado, peça de manutenção
// etc. Ver enum TipoCompra e campo descricaoLivre no schema
// (prisma/schema/08-compras.prisma).
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260906150000_compras_tipo_e_custo_aquisicao/migration.sql
// tiver sido aplicada no banco (colunas tipoCompra/descricaoLivre/
// tipoCompraOutro em solicitacoes_compra ainda não existem até lá) — mesmo
// aviso de origem-solicitacao-compra.test.ts.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => redirectMock(url),
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
import { criarSolicitacaoCompra } from "./actions";
import { avancarStatusCompra, type SolicitacaoParaTransicao } from "./status-transicao";
import type { StatusSolicitacaoCompra } from "@/lib/compras-status";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  categoriaCustoId: string;
  itemGraficaId: string;
  orcamentoId: string;
  pedidoId: string;
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Tipo Compra ${s}`, slug: `teste-tipo-compra-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-tipo-compra-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const categoria = await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: `Papel ${s}` } });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, estoqueAtual: 0 },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuarioDono.id, status: "APROVADO", total: 500 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "ARTE" },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
    categoriaCustoId: categoria.id,
    itemGraficaId: itemGrafica.id,
    orcamentoId: orcamento.id,
    pedidoId: pedido.id,
  };
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
    tipoCompra: solicitacao.tipoCompra,
    valorFrete: solicitacao.valorFrete,
    valorIpi: solicitacao.valorIpi,
    valorIcmsCreditavel: solicitacao.valorIcmsCreditavel,
    valorDesconto: solicitacao.valorDesconto,
    quantidadeRecebida: solicitacao.quantidadeRecebida,
  };
}

// Achado A7 (Parte 3/Compras, 2026-09-07): RECEBIDO agora exige
// quantidadeRecebida — sempre a quantidade total solicitada aqui, pra fechar
// em RECEBIDO direto (zero regressão, mesmo comportamento de antes).
async function avancarAteRecebido(solicitacaoId: string, usuarioId: string, valorFinal: number) {
  for (const proximo of ["APROVADO", "COMPRADO", "RECEBIDO"] as StatusSolicitacaoCompra[]) {
    const atual = await solicitacaoParaTransicao(solicitacaoId);
    const dados =
      proximo === "COMPRADO"
        ? { valorFinal }
        : proximo === "RECEBIDO"
          ? { quantidadeRecebida: Number(atual.quantidade) }
          : {};
    const resultado = await avancarStatusCompra(atual, proximo, { id: usuarioId }, dados);
    if (!resultado.ok) throw new Error(`Falha avançando pra ${proximo}: ${resultado.mensagem}`);
  }
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.solicitacaoCompra.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
  redirectMock.mockClear();
}, TIMEOUT_MS);

describe("criarSolicitacaoCompra — itemGraficaId nullable + descricaoLivre (achado A1)", () => {
  it(
    "rejeita quando nem itemGraficaId nem descricaoLivre foram informados",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("quantidade", "1");
      fd.set("tipoCompra", "SERVICO_TERCEIRIZADO");
      // itemGraficaId e descricaoLivre de propósito ausentes

      const resultado = await criarSolicitacaoCompra(null, fd);

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/selecione uma matéria-prima|descreva o que está sendo comprado/i);
      expect(redirectMock).not.toHaveBeenCalled();

      const criadas = await prisma.solicitacaoCompra.findMany({ where: { graficaId: f.graficaId } });
      expect(criadas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "aceita descricaoLivre sem itemGraficaId — compra de serviço terceirizado (ex: clichê de clicheria)",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("descricaoLivre", "Clichê 4 cores — arte Rótulo Cerveja X");
      fd.set("tipoCompra", "SERVICO_TERCEIRIZADO");
      fd.set("quantidade", "1");

      await expect(criarSolicitacaoCompra(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      expect(redirectMock).toHaveBeenCalledTimes(1);
      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: novaId } });
      expect(solicitacao.itemGraficaId).toBeNull();
      expect(solicitacao.descricaoLivre).toBe("Clichê 4 cores — arte Rótulo Cerveja X");
      expect(solicitacao.tipoCompra).toBe("SERVICO_TERCEIRIZADO");
    },
    TIMEOUT_MS
  );

  it(
    "tipoCompra ausente no form default pra MATERIA_PRIMA — comportamento de hoje preservado",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("quantidade", "50");
      // tipoCompra de propósito ausente (formulário anterior a esta feature)

      await expect(criarSolicitacaoCompra(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);
      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: novaId } });
      expect(solicitacao.tipoCompra).toBe("MATERIA_PRIMA");
      expect(solicitacao.itemGraficaId).toBe(f.itemGraficaId);
    },
    TIMEOUT_MS
  );
});

describe("RECEBIDO de compra tipoCompra != MATERIA_PRIMA nunca gera MovimentacaoEstoque (achado A1)", () => {
  it(
    "SERVICO_TERCEIRIZADO sem itemGraficaId: RECEBIDO não gera MovimentacaoEstoque, mas gera CustoPedido quando há pedidoId",
    async () => {
      const f = await criarFixture();
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          tipoCompra: "SERVICO_TERCEIRIZADO",
          descricaoLivre: "Clichê 4 cores",
          quantidade: 1,
          origem: "PEDIDO_ESPECIFICO",
          pedidoId: f.pedidoId,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });

      await avancarAteRecebido(solicitacao.id, f.usuarioDonoId, 250);

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { solicitacaoCompraId: solicitacao.id },
      });
      expect(movimentacoes).toHaveLength(0); // nunca vira estoque

      const custo = await prisma.custoPedido.findUnique({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(custo).not.toBeNull(); // mas o custo do pedido continua sendo registrado
      expect(custo!.origem).toBe("COMPRA");
      expect(Number(custo!.valor)).toBe(250);

      const solicitacaoDepois = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: solicitacao.id } });
      expect(solicitacaoDepois.status).toBe("RECEBIDO"); // a transição em si não é afetada
    },
    TIMEOUT_MS
  );

  it(
    "PECA_MANUTENCAO com itemGraficaId de catálogo (matéria-prima cadastrada emprestada pra outro uso) ainda assim não gera estoque — só MATERIA_PRIMA gera",
    async () => {
      const f = await criarFixture();
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          tipoCompra: "PECA_MANUTENCAO",
          itemGraficaId: f.itemGraficaId, // presente, mas tipoCompra != MATERIA_PRIMA
          descricaoLivre: "Correia dentada da guilhotina",
          quantidade: 1,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });

      const itemAntes = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });

      await avancarAteRecebido(solicitacao.id, f.usuarioDonoId, 90);

      const itemDepois = await prisma.itemGrafica.findUniqueOrThrow({ where: { id: f.itemGraficaId } });
      expect(Number(itemDepois.estoqueAtual)).toBe(Number(itemAntes.estoqueAtual)); // estoque intocado

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { solicitacaoCompraId: solicitacao.id },
      });
      expect(movimentacoes).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "MATERIA_PRIMA com itemGraficaId (comportamento de sempre): RECEBIDO gera MovimentacaoEstoque normalmente — regressão zero",
    async () => {
      const f = await criarFixture();
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: f.itemGraficaId,
          quantidade: 10,
          usuarioSolicitanteId: f.usuarioDonoId,
          // tipoCompra default MATERIA_PRIMA
        },
      });

      await avancarAteRecebido(solicitacao.id, f.usuarioDonoId, 100);

      const movimentacoes = await prisma.movimentacaoEstoque.findMany({
        where: { solicitacaoCompraId: solicitacao.id },
      });
      expect(movimentacoes).toHaveLength(1);
    },
    TIMEOUT_MS
  );
});
