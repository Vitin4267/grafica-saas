import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/compras/cotacao-fornecedor.test.ts e
// src/app/orcamento/[id]/actions.duplicar.test.ts) — cobre o achado A3 da
// auditoria de abrangência (Parte 3/Compras, 2026-08-29): SolicitacaoCompra
// não distinguia reposição de estoque (make-to-stock) de compra pra um
// Pedido específico (make-to-order), e o custo dessa compra nunca chegava
// ao pedido quando o item comprado não está na ficha técnica.
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260829100000_origem_solicitacao_compra/migration.sql
// tiver sido aplicada no banco (colunas origem/origemOutro/pedidoId em
// solicitacoes_compra, solicitacaoCompraId em custos_pedido e o valor
// 'COMPRA' em OrigemCusto ainda não existem até lá).
//
// redirect() é mockado (não next/navigation inteiro — só a função) porque
// criarSolicitacaoCompra navega pra tela da nova solicitação no caminho de
// SUCESSO via redirect(), que fora de uma requisição Next.js de verdade
// lança NEXT_REDIRECT — mesmo dublê de actions.duplicar.test.ts.
// exigirUsuarioAutenticado/exigirEmailVerificado/exigirAssinaturaAtiva são
// mockados pelo mesmo motivo (dependem de cookies()/headers() de uma
// requisição de verdade). podeEditarModulo roda de verdade (usuário papel
// DONO sempre passa, ver src/lib/auth/permissoes.ts).
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
import { criarCustoAutomaticoCompra } from "@/lib/custo-pedido";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
  categoriaCustoId: string;
  itemGraficaId: string; // matéria-prima
  produtoId: string;
  orcamentoId: string;
  pedidoId: string;
};

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Origem Compra ${s}`, slug: `teste-origem-compra-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-origem-compra-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const categoria = await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: `Papel ${s}` } });

  const catalogoMateriaPrima = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Chapa offset ${s}` },
  });
  const materiaPrima = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoMateriaPrima.id, estoqueAtual: 0 },
  });

  const catalogoProduto = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão de Visita ${s}` },
  });
  const produto = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
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
    itemGraficaId: materiaPrima.id,
    produtoId: produto.id,
    orcamentoId: orcamento.id,
    pedidoId: pedido.id,
  };
}

// Monta o SolicitacaoParaTransicao lendo o estado ATUAL do banco — mesma
// necessidade de cotacao-fornecedor.test.ts: o CAS de avancarStatusCompra
// exige que o `status` passado bata com o gravado.
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

// SOLICITADO→APROVADO→COMPRADO→RECEBIDO, sem cotação (mesmo caminho "direto"
// já coberto em cotacao-fornecedor.test.ts) — usada pelos testes que
// precisam chegar em RECEBIDO pra checar o CustoPedido gerado.
async function avancarAteRecebido(solicitacaoId: string, usuarioId: string, valorFinal: number) {
  for (const proximo of ["APROVADO", "COMPRADO", "RECEBIDO"] as StatusSolicitacaoCompra[]) {
    const atual = await solicitacaoParaTransicao(solicitacaoId);
    const dados = proximo === "COMPRADO" ? { valorFinal } : {};
    const resultado = await avancarStatusCompra(atual, proximo, { id: usuarioId }, dados);
    if (!resultado.ok) throw new Error(`Falha avançando pra ${proximo}: ${resultado.mensagem}`);
  }
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.movimentacaoEstoque.deleteMany({ where: { itemGrafica: { graficaId } } });
    await prisma.solicitacaoCompra.deleteMany({ where: { graficaId } });
    await prisma.fichaTecnicaItem.deleteMany({ where: { itemGrafica: { graficaId } } });
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

describe("criarSolicitacaoCompra — origem PEDIDO_ESPECIFICO (achado A3 da auditoria de abrangência)", () => {
  it(
    "rejeita origem=PEDIDO_ESPECIFICO sem pedidoId",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("quantidade", "50");
      fd.set("origem", "PEDIDO_ESPECIFICO");
      // pedidoId de propósito ausente

      const resultado = await criarSolicitacaoCompra(null, fd);

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/selecione o pedido/i);
      expect(redirectMock).not.toHaveBeenCalled();

      const criadas = await prisma.solicitacaoCompra.findMany({ where: { graficaId: f.graficaId } });
      expect(criadas).toHaveLength(0); // nada foi criado
    },
    TIMEOUT_MS
  );

  it(
    "aceita origem=PEDIDO_ESPECIFICO com pedidoId válido, grava o vínculo",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("quantidade", "50");
      fd.set("origem", "PEDIDO_ESPECIFICO");
      fd.set("pedidoId", f.pedidoId);

      await expect(criarSolicitacaoCompra(null, fd)).rejects.toThrow(/^NEXT_REDIRECT:/);

      expect(redirectMock).toHaveBeenCalledTimes(1);
      const novaId = (redirectMock.mock.calls[0][0] as string).split("/").pop()!;
      const solicitacao = await prisma.solicitacaoCompra.findUniqueOrThrow({ where: { id: novaId } });
      expect(solicitacao.origem).toBe("PEDIDO_ESPECIFICO");
      expect(solicitacao.pedidoId).toBe(f.pedidoId);
    },
    TIMEOUT_MS
  );

  it(
    "pedidoId de outra gráfica é rejeitado mesmo com origem=PEDIDO_ESPECIFICO — nunca confia em pedidoId vindo do client",
    async () => {
      const f = await criarFixture();
      const outraGrafica = await criarFixture(); // outro tenant, outro pedido
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioDonoId } })) as never
      );

      const fd = new FormData();
      fd.set("itemGraficaId", f.itemGraficaId);
      fd.set("quantidade", "50");
      fd.set("origem", "PEDIDO_ESPECIFICO");
      fd.set("pedidoId", outraGrafica.pedidoId); // pedido de outra gráfica

      const resultado = await criarSolicitacaoCompra(null, fd);

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/pedido selecionado é inválido/i);
      expect(redirectMock).not.toHaveBeenCalled();
    },
    TIMEOUT_MS
  );
});

describe("RECEBIDO de uma compra PEDIDO_ESPECIFICO gera CustoPedido origem COMPRA (achado A3)", () => {
  it(
    "gera CustoPedido origem=COMPRA vinculado ao Pedido certo, com o valor pago",
    async () => {
      const f = await criarFixture();
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: f.itemGraficaId,
          quantidade: 20,
          origem: "PEDIDO_ESPECIFICO",
          pedidoId: f.pedidoId,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });

      await avancarAteRecebido(solicitacao.id, f.usuarioDonoId, 350);

      const custo = await prisma.custoPedido.findUnique({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(custo).not.toBeNull();
      expect(custo!.origem).toBe("COMPRA");
      expect(custo!.pedidoId).toBe(f.pedidoId);
      expect(Number(custo!.valor)).toBe(350);
      expect(custo!.categoriaCustoId).toBe(f.categoriaCustoId); // fallback pra primeira categoria ativa
    },
    TIMEOUT_MS
  );

  it(
    "dedup via solicitacaoCompraId — chamar criarCustoAutomaticoCompra de novo pra mesma solicitação não duplica",
    async () => {
      const f = await criarFixture();
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: f.itemGraficaId,
          quantidade: 20,
          origem: "PEDIDO_ESPECIFICO",
          pedidoId: f.pedidoId,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });
      await avancarAteRecebido(solicitacao.id, f.usuarioDonoId, 350);

      const antes = await prisma.custoPedido.count({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(antes).toBe(1);

      // Reentrância manual (duplo clique, retry) — mesma chamada que
      // avancarStatusCompra faria de novo se fosse possível re-executar
      // RECEBIDO.
      await prisma.$transaction(async (tx) => {
        await criarCustoAutomaticoCompra(tx, {
          graficaId: f.graficaId,
          pedidoId: f.pedidoId,
          solicitacaoCompraId: solicitacao.id,
          itemGraficaId: f.itemGraficaId,
          varianteId: null,
          categoriaCustoIdMaterial: null,
          valor: 350,
        });
      });

      const depois = await prisma.custoPedido.count({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(depois).toBe(1); // continua 1, não duplicou
    },
    TIMEOUT_MS
  );

  it(
    "possivelDuplicidade=true quando o material comprado também está na ficha técnica deste pedido",
    async () => {
      const f = await criarFixture();
      // A matéria-prima comprada TAMBÉM é consumida pela ficha técnica do
      // produto deste mesmo pedido — risco real de contar o custo duas
      // vezes (aqui na compra, depois de novo via CONSUMO_ESTOQUE).
      await prisma.fichaTecnicaItem.create({
        data: { itemGraficaId: f.produtoId, materiaPrimaId: f.itemGraficaId, quantidadePorUnidade: 1 },
      });
      await prisma.orcamentoItem.create({
        data: { orcamentoId: f.orcamentoId, itemGraficaId: f.produtoId, quantidade: 10, precoUnitario: 50, precoTotal: 500 },
      });

      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: f.itemGraficaId,
          quantidade: 20,
          origem: "PEDIDO_ESPECIFICO",
          pedidoId: f.pedidoId,
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });
      await avancarAteRecebido(solicitacao.id, f.usuarioDonoId, 350);

      const custo = await prisma.custoPedido.findUnique({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(custo!.possivelDuplicidade).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "REPOSICAO_ESTOQUE (sem pedido) chegando em RECEBIDO nunca gera CustoPedido — comportamento de hoje preservado",
    async () => {
      const f = await criarFixture();
      const solicitacao = await prisma.solicitacaoCompra.create({
        data: {
          graficaId: f.graficaId,
          itemGraficaId: f.itemGraficaId,
          quantidade: 20,
          // origem default REPOSICAO_ESTOQUE, sem pedidoId
          usuarioSolicitanteId: f.usuarioDonoId,
        },
      });
      expect(solicitacao.origem).toBe("REPOSICAO_ESTOQUE");
      expect(solicitacao.pedidoId).toBeNull();

      await avancarAteRecebido(solicitacao.id, f.usuarioDonoId, 350);

      const custo = await prisma.custoPedido.findUnique({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(custo).toBeNull();

      // A entrada de estoque em si continua acontecendo normalmente —
      // só o CustoPedido é que nunca nasce sem pedidoId.
      const movimentacao = await prisma.movimentacaoEstoque.findFirst({ where: { solicitacaoCompraId: solicitacao.id } });
      expect(movimentacao).not.toBeNull();
    },
    TIMEOUT_MS
  );
});
