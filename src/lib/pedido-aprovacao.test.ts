import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { calcularPrevisaoAprovacaoPedido } from "./pedido-aprovacao";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/producao/status-transicao.custo-automatico.test.ts)
// — cobre o item 3 do PR "ficha técnica de acabamento" (fase-custo-real.md):
// calcularPrevisaoAprovacaoPedido soma também a ficha técnica dos SERVIÇOS
// anexados como acabamento, usando OrcamentoItemAcabamento.qtdBase como
// multiplicador em vez de item.quantidade. calcularPrevisaoAprovacaoPedido
// não exige sessão autenticada (não lê cookies), então é chamada direto,
// sem precisar simular login — os mocks abaixo (next/cache, auth) só
// existem pro describe do achado B9, que precisa de adicionarItemOrcamento
// (uma Server Action) pra gerar um breakdown REAL do motor de precificação.
const TIMEOUT_MS = 30_000;

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
import { adicionarItemOrcamento } from "@/app/orcamento/[id]/actions/itens";

const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.fichaTecnicaItem.deleteMany({ where: { itemGrafica: { graficaId } } });
    // itemGrafica ANTES de maquinaSetupPorPeca (FK RESTRICT, mesma ordem de
    // src/app/orcamento/[id]/actions/faixas.test.ts).
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.maquinaSetupPorPeca.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.categoriaCusto.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("previsão de custo soma a ficha técnica dos acabamentos anexados", () => {
  it(
    "item SIMPLES com produto + acabamento gera uma linha de previsão por categoria pra cada um",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Previsão Acabamento ${s}`, slug: `teste-previsao-acabamento-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
      const usuario = await prisma.usuario.create({
        data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-previsao-acabamento-${s}@example.com`, senhaHash: "x" },
      });

      const categoriaPapel = await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: `Papel ${s}` } });
      const categoriaLaminacao = await prisma.categoriaCusto.create({
        data: { graficaId: grafica.id, nome: `Laminação ${s}` },
      });

      // Produto SIMPLES com ficha técnica (papel) — categoria própria pra
      // separar da linha do acabamento na asserção.
      const precoCompraPapel = 3.5;
      const catalogoPapel = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché 150g ${s}` },
      });
      const papel = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoPapel.id, precoCompra: precoCompraPapel, categoriaCustoId: categoriaPapel.id },
      });
      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão de Visita ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
      });
      const quantidadePorUnidadeProduto = 2;
      await prisma.fichaTecnicaItem.create({
        data: { itemGraficaId: produto.id, materiaPrimaId: papel.id, quantidadePorUnidade: quantidadePorUnidadeProduto },
      });

      // Serviço (acabamento) com ficha técnica própria (BOPP) — é exatamente
      // o que este PR habilita (FichaTecnicaItem.itemGraficaId de um SERVICO).
      const precoCompraBopp = 0.8;
      const catalogoBopp = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Laminação", nome: `BOPP ${s}` },
      });
      const bopp = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoBopp.id, precoCompra: precoCompraBopp, categoriaCustoId: categoriaLaminacao.id },
      });
      const catalogoServico = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "SERVICO", categoria: "Acabamento", nome: `Laminação ${s}` },
      });
      const servico = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoServico.id },
      });
      const quantidadePorUnidadeAcabamento = 1.1;
      await prisma.fichaTecnicaItem.create({
        data: { itemGraficaId: servico.id, materiaPrimaId: bopp.id, quantidadePorUnidade: quantidadePorUnidadeAcabamento },
      });

      const orcamento = await prisma.orcamento.create({
        data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 500 },
      });
      const quantidadeItem = 10;
      const orcamentoItem = await prisma.orcamentoItem.create({
        data: {
          orcamentoId: orcamento.id,
          itemGraficaId: produto.id,
          quantidade: quantidadeItem,
          precoUnitario: 50,
          precoTotal: 500,
        },
      });
      const qtdBaseAcabamento = 420;
      await prisma.orcamentoItemAcabamento.create({
        data: {
          orcamentoItemId: orcamentoItem.id,
          itemGraficaId: servico.id,
          qtdBase: qtdBaseAcabamento,
          custoCalculado: 0,
        },
      });

      const previsao = await calcularPrevisaoAprovacaoPedido(orcamento.id, grafica.id);

      expect(previsao.itensSemPrevisao).toHaveLength(0);
      expect(previsao.linhas).toHaveLength(2);

      const linhaPapel = previsao.linhas.find((l) => l.categoriaCustoId === categoriaPapel.id);
      expect(linhaPapel).toBeDefined();
      expect(linhaPapel!.origem).toBe("FICHA_TECNICA");
      expect(Number(linhaPapel!.valor)).toBeCloseTo(quantidadePorUnidadeProduto * quantidadeItem * precoCompraPapel, 2);

      const linhaLaminacao = previsao.linhas.find((l) => l.categoriaCustoId === categoriaLaminacao.id);
      expect(linhaLaminacao).toBeDefined();
      expect(linhaLaminacao!.origem).toBe("FICHA_TECNICA");
      // Multiplicador é qtdBase (420) do acabamento, não quantidadeItem (10)
      // do item de orçamento — é a diferença que este PR corrige.
      expect(Number(linhaLaminacao!.valor)).toBeCloseTo(
        quantidadePorUnidadeAcabamento * qtdBaseAcabamento * precoCompraBopp,
        2
      );

      const totalEsperado =
        quantidadePorUnidadeProduto * quantidadeItem * precoCompraPapel +
        quantidadePorUnidadeAcabamento * qtdBaseAcabamento * precoCompraBopp;
      expect(Number(previsao.custoPrevistoTotal)).toBeCloseTo(totalEsperado, 2);
    },
    TIMEOUT_MS
  );

  it(
    "acabamento SEM ficha técnica cadastrada não entra na previsão nem marca previsão parcial (comportamento aditivo)",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Previsão Acabamento Vazio ${s}`, slug: `teste-previsao-acabamento-vazio-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
      const usuario = await prisma.usuario.create({
        data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-previsao-acabamento-vazio-${s}@example.com`, senhaHash: "x" },
      });
      const categoria = await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: `Papel ${s}` } });

      const precoCompraPapel = 3.5;
      const catalogoPapel = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Couché 150g ${s}` },
      });
      const papel = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoPapel.id, precoCompra: precoCompraPapel, categoriaCustoId: categoria.id },
      });
      const catalogoProduto = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Cartão de Visita ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoProduto.id },
      });
      await prisma.fichaTecnicaItem.create({
        data: { itemGraficaId: produto.id, materiaPrimaId: papel.id, quantidadePorUnidade: 2 },
      });

      // Serviço SEM ficha técnica cadastrada — o caso mais comum ainda.
      const catalogoServico = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "SERVICO", categoria: "Acabamento", nome: `Laminação ${s}` },
      });
      const servico = await prisma.itemGrafica.create({
        data: { graficaId: grafica.id, itemCatalogoId: catalogoServico.id },
      });

      const orcamento = await prisma.orcamento.create({
        data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "APROVADO", total: 500 },
      });
      const orcamentoItem = await prisma.orcamentoItem.create({
        data: {
          orcamentoId: orcamento.id,
          itemGraficaId: produto.id,
          quantidade: 10,
          precoUnitario: 50,
          precoTotal: 500,
        },
      });
      await prisma.orcamentoItemAcabamento.create({
        data: { orcamentoItemId: orcamentoItem.id, itemGraficaId: servico.id, qtdBase: 420, custoCalculado: 0 },
      });

      const previsao = await calcularPrevisaoAprovacaoPedido(orcamento.id, grafica.id);

      // Só a linha do produto (papel) — o acabamento sem ficha técnica não
      // contribui em nada e não marca previsão parcial.
      expect(previsao.itensSemPrevisao).toHaveLength(0);
      expect(previsao.linhas).toHaveLength(1);
      expect(Number(previsao.linhas[0].valor)).toBeCloseTo(2 * 10 * precoCompraPapel, 2);
    },
    TIMEOUT_MS
  );
});

describe("achado B9 da auditoria do motor de preço (2026-09-13): SERIGRAFIA separa peça em branco (material) de serviço (impressão) na previsão de custo", () => {
  it(
    "custoSubstrato (peça em branco) vai pra categoria do PRODUTO; setup+variável vai pra categoria 'Impressão' — não tudo junto",
    async () => {
      const s = sufixo();
      const grafica = await prisma.grafica.create({
        data: { nome: `Teste Previsão B9 ${s}`, slug: `teste-previsao-b9-${s}` },
      });
      graficaIdsParaLimpar.push(grafica.id);
      const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
      const usuario = await prisma.usuario.create({
        data: { graficaId: grafica.id, nome: `Usuário ${s}`, email: `teste-previsao-b9-${s}@example.com`, senhaHash: "x", papel: "DONO" },
      });

      // Duas categorias DISTINTAS — antes da correção, tudo (peça em branco
      // + serviço) caía junto em "Impressão"; depois, a peça em branco
      // (custoSubstrato) tem que aparecer na categoria do PRODUTO.
      const categoriaPecaEmBranco = await prisma.categoriaCusto.create({
        data: { graficaId: grafica.id, nome: `Camiseta em branco ${s}` },
      });
      await prisma.categoriaCusto.create({ data: { graficaId: grafica.id, nome: "Impressão" } });

      const maquina = await prisma.maquinaSetupPorPeca.create({
        data: {
          graficaId: grafica.id,
          nome: `Carrossel 6 cores ${s}`,
          tipoProcesso: "SERIGRAFIA",
          custoPorSetup: 40,
          custoPorPeca: 2,
          custoMinimo: 0,
        },
      });
      const catalogo = await prisma.itemCatalogo.create({
        data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Camiseta", nome: `Camiseta Serigrafia ${s}` },
      });
      const produto = await prisma.itemGrafica.create({
        data: {
          graficaId: grafica.id,
          itemCatalogoId: catalogo.id,
          modeloCalculo: "SERIGRAFIA",
          precoCompra: 25, // camiseta em branco — custoSubstratoPorPeca
          precoVenda: 999,
          maquinaSetupPorPecaId: maquina.id,
          categoriaCustoId: categoriaPecaEmBranco.id,
        },
      });
      const orcamento = await prisma.orcamento.create({
        data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: usuario.id, status: "RASCUNHO", total: 0 },
      });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(usuario as never);
      const resultado = await adicionarItemOrcamento(
        null,
        formDataDe({
          orcamentoId: orcamento.id,
          itemGraficaId: produto.id,
          quantidade: "5",
          unidadeDimensao: "CM",
          numeroSetups: "1",
        })
      );
      expect(resultado.ok).toBe(true);

      const previsao = await calcularPrevisaoAprovacaoPedido(orcamento.id, grafica.id);

      expect(previsao.itensSemPrevisao).toHaveLength(0);
      // custoSetup=1×40=40, custoVariavel=5×2=10, custoSubstrato=5×25=125.
      const linhaPecaEmBranco = previsao.linhas.find((l) => l.categoriaCustoId === categoriaPecaEmBranco.id);
      expect(linhaPecaEmBranco).toBeDefined();
      expect(Number(linhaPecaEmBranco!.valor)).toBeCloseTo(125, 2);

      const linhaImpressao = previsao.linhas.find((l) => l.categoriaCustoId !== categoriaPecaEmBranco.id);
      expect(linhaImpressao).toBeDefined();
      // ANTES da correção, esta linha seria 175 (40+10+125 — tudo junto em
      // "impressão", incluindo a peça em branco).
      expect(Number(linhaImpressao!.valor)).toBeCloseTo(50, 2);
    },
    TIMEOUT_MS
  );
});
