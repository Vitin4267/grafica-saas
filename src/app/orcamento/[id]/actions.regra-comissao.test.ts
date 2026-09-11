import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.comissao-custo.test.ts e
// actions.vendedor-cliente.test.ts) — cobre o achado A12 da Parte 4 da
// auditoria de abrangência (Financeiro): RegraComissao (resolução por
// especificidade) e vendedor-sem-cadastro (Orcamento.vendedor só texto
// livre, sem Usuario). Ver src/lib/comissao-aprovacao.ts.
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
import { atualizarStatusOrcamento } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.custoPedido.deleteMany({ where: { graficaId } });
    await prisma.comissao.deleteMany({ where: { graficaId } });
    await prisma.regraComissao.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.parametrosGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

// Fixture comum: gráfica + vendedor com 10% de comissaoPercent + cliente +
// produto de R$1.000 (sem custo, LUCRO == VALOR pra simplificar as contas).
async function criarFixtureBase() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Regra Comissao ${s}`, slug: `teste-regra-comissao-${s}` },
  });
  const vendedor = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Vendedor ${s}`,
      email: `vendedor-regra-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      comissaoPercent: 0.1,
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 1000, precoCompra: 1 },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { s, grafica, vendedor, cliente, catalogo, itemGrafica };
}

async function criarOrcamento(opts: {
  graficaId: string;
  clienteId: string;
  usuarioId: string;
  itemGraficaId: string;
  vendedorUsuarioId?: string | null;
  vendedorTexto?: string | null;
}) {
  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: opts.graficaId,
      clienteId: opts.clienteId,
      usuarioId: opts.usuarioId,
      status: "ENVIADO",
      total: 1000,
      vendedorUsuarioId: opts.vendedorUsuarioId ?? null,
      vendedor: opts.vendedorTexto ?? null,
    },
  });
  await prisma.orcamentoItem.create({
    data: {
      orcamentoId: orcamento.id,
      itemGraficaId: opts.itemGraficaId,
      quantidade: 1,
      precoUnitario: 1000,
      precoTotal: 1000,
    },
  });
  return orcamento;
}

describe("achado A12 da Parte 4 — RegraComissao (resolução por especificidade)", () => {
  it(
    "regressão zero: nenhuma RegraComissao cadastrada — usa Usuario.comissaoPercent exatamente como antes",
    async () => {
      const f = await criarFixtureBase();
      const orcamento = await criarOrcamento({
        graficaId: f.grafica.id,
        clienteId: f.cliente.id,
        usuarioId: f.vendedor.id,
        itemGraficaId: f.itemGrafica.id,
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.vendedor.id } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: orcamento.id, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUniqueOrThrow({ where: { orcamentoId: orcamento.id } });
      expect(comissao.usuarioId).toBe(f.vendedor.id);
      expect(comissao.representanteNome).toBeNull();
      expect(Number(comissao.percentualAplicado)).toBeCloseTo(0.1, 4);
      expect(Number(comissao.valorComissao)).toBeCloseTo(100, 2); // 10% de 1000, igual Usuario.comissaoPercent
    },
    TIMEOUT_MS
  );

  it(
    "regra mais específica (usuário + item) vence a taxa pessoal genérica do Usuario.comissaoPercent",
    async () => {
      const f = await criarFixtureBase();
      // Regra específica: ESTE vendedor + ESTE item ganha 25% em vez dos 10%
      // pessoais de Usuario.comissaoPercent.
      await prisma.regraComissao.create({
        data: {
          graficaId: f.grafica.id,
          usuarioId: f.vendedor.id,
          itemCatalogoId: f.catalogo.id,
          percentual: 0.25,
        },
      });
      const orcamento = await criarOrcamento({
        graficaId: f.grafica.id,
        clienteId: f.cliente.id,
        usuarioId: f.vendedor.id,
        itemGraficaId: f.itemGrafica.id,
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.vendedor.id } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: orcamento.id, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUniqueOrThrow({ where: { orcamentoId: orcamento.id } });
      expect(Number(comissao.percentualAplicado)).toBeCloseTo(0.25, 4);
      expect(Number(comissao.valorComissao)).toBeCloseTo(250, 2);
    },
    TIMEOUT_MS
  );

  it(
    "regra por categoria (menos específica) só se aplica quando a regra por usuário+item não bate",
    async () => {
      const f = await criarFixtureBase();
      // Regra genérica por categoria: 15% pra qualquer venda de "Cartão".
      await prisma.regraComissao.create({
        data: { graficaId: f.grafica.id, tipoItem: "Cartão", percentual: 0.15 },
      });
      const orcamento = await criarOrcamento({
        graficaId: f.grafica.id,
        clienteId: f.cliente.id,
        usuarioId: f.vendedor.id,
        itemGraficaId: f.itemGrafica.id,
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.vendedor.id } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: orcamento.id, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUniqueOrThrow({ where: { orcamentoId: orcamento.id } });
      // 15% da regra de categoria vence os 10% pessoais de Usuario.comissaoPercent
      // (mais específica: 1 filtro preenchido vs. 0).
      expect(Number(comissao.percentualAplicado)).toBeCloseTo(0.15, 4);
    },
    TIMEOUT_MS
  );

  it(
    "regra desativada (ativa=false) nunca é considerada — cai no fallback de Usuario.comissaoPercent",
    async () => {
      const f = await criarFixtureBase();
      await prisma.regraComissao.create({
        data: {
          graficaId: f.grafica.id,
          usuarioId: f.vendedor.id,
          percentual: 0.5,
          ativa: false,
        },
      });
      const orcamento = await criarOrcamento({
        graficaId: f.grafica.id,
        clienteId: f.cliente.id,
        usuarioId: f.vendedor.id,
        itemGraficaId: f.itemGrafica.id,
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.vendedor.id } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: orcamento.id, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUniqueOrThrow({ where: { orcamentoId: orcamento.id } });
      expect(Number(comissao.percentualAplicado)).toBeCloseTo(0.1, 4);
    },
    TIMEOUT_MS
  );
});

describe("achado A12 da Parte 4 — vendedor sem cadastro (Orcamento.vendedor texto livre)", () => {
  it(
    "sem vendedorUsuarioId, com Orcamento.vendedor texto + fallback configurado: gera Comissao com usuarioId=null e representanteNome",
    async () => {
      const f = await criarFixtureBase();
      await prisma.parametrosGrafica.create({
        data: { graficaId: f.grafica.id, comissaoRepresentanteSemCadastroPercent: 0.06 },
      });
      const orcamento = await criarOrcamento({
        graficaId: f.grafica.id,
        clienteId: f.cliente.id,
        usuarioId: f.vendedor.id, // quem DIGITOU — não deveria receber a comissão aqui
        itemGraficaId: f.itemGrafica.id,
        vendedorTexto: "Fulano de Tal (representante externo)",
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.vendedor.id } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: orcamento.id, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUniqueOrThrow({ where: { orcamentoId: orcamento.id } });
      expect(comissao.usuarioId).toBeNull();
      expect(comissao.representanteNome).toBe("Fulano de Tal (representante externo)");
      expect(Number(comissao.percentualAplicado)).toBeCloseTo(0.06, 4);
      expect(Number(comissao.valorComissao)).toBeCloseTo(60, 2);
    },
    TIMEOUT_MS
  );

  it(
    "regressão zero: vendedor texto livre SEM fallback configurado (comissaoRepresentanteSemCadastroPercent null) — nenhuma Comissao nasce",
    async () => {
      const f = await criarFixtureBase();
      // ParametrosGrafica nasce sem comissaoRepresentanteSemCadastroPercent
      // (null, default) — mesmo que a gráfica tenha outros parâmetros.
      await prisma.parametrosGrafica.create({ data: { graficaId: f.grafica.id } });
      const orcamento = await criarOrcamento({
        graficaId: f.grafica.id,
        clienteId: f.cliente.id,
        usuarioId: f.vendedor.id,
        itemGraficaId: f.itemGrafica.id,
        vendedorTexto: "Beltrano Representante",
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.vendedor.id } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: orcamento.id, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUnique({ where: { orcamentoId: orcamento.id } });
      expect(comissao).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "RegraComissao coringa (usuarioId null) resolve vendedor sem cadastro mesmo sem fallback de ParametrosGrafica",
    async () => {
      const f = await criarFixtureBase();
      await prisma.parametrosGrafica.create({ data: { graficaId: f.grafica.id } }); // sem fallback
      await prisma.regraComissao.create({
        data: { graficaId: f.grafica.id, tipoItem: "Cartão", percentual: 0.04 },
      });
      const orcamento = await criarOrcamento({
        graficaId: f.grafica.id,
        clienteId: f.cliente.id,
        usuarioId: f.vendedor.id,
        itemGraficaId: f.itemGrafica.id,
        vendedorTexto: "Ciclano Representante",
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.vendedor.id } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: orcamento.id, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUniqueOrThrow({ where: { orcamentoId: orcamento.id } });
      expect(comissao.usuarioId).toBeNull();
      expect(comissao.representanteNome).toBe("Ciclano Representante");
      expect(Number(comissao.percentualAplicado)).toBeCloseTo(0.04, 4);
    },
    TIMEOUT_MS
  );

  it(
    "Orcamento.vendedorUsuarioId presente vence o texto livre — comissão vai pro usuário cadastrado, não representanteNome",
    async () => {
      const f = await criarFixtureBase();
      const outroUsuario = await prisma.usuario.create({
        data: {
          graficaId: f.grafica.id,
          nome: `Vendedor Real ${f.s}`,
          email: `vendedor-real-${f.s}@example.com`,
          senhaHash: "x",
          papel: "DONO",
          comissaoPercent: 0.2,
        },
      });
      const orcamento = await criarOrcamento({
        graficaId: f.grafica.id,
        clienteId: f.cliente.id,
        usuarioId: f.vendedor.id,
        itemGraficaId: f.itemGrafica.id,
        vendedorUsuarioId: outroUsuario.id,
        vendedorTexto: "Nome desatualizado, ignorado",
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.vendedor.id } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: orcamento.id, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUniqueOrThrow({ where: { orcamentoId: orcamento.id } });
      expect(comissao.usuarioId).toBe(outroUsuario.id);
      expect(comissao.representanteNome).toBeNull();
      expect(Number(comissao.percentualAplicado)).toBeCloseTo(0.2, 4);
    },
    TIMEOUT_MS
  );
});
