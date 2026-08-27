import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.comissao-custo.test.ts) — cobre o achado A8 da
// auditoria de abrangência (pesquisa-abrangencia-modulos.md): sem vendedor
// atribuído ao Cliente, a comissão sempre nasce de Orcamento.usuarioId (quem
// DIGITOU o orçamento), nunca de quem efetivamente vendeu. Este arquivo
// cobre a implementação: quando ParametrosGrafica.comissaoSegueVendedorDoCliente
// está ligada, Comissao.usuarioId passa a refletir Cliente.vendedorId — e
// preserva o comportamento de hoje (Orcamento.usuarioId) quando a flag está
// desligada (default) ou o cliente não tem vendedor atribuído.
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

type Fixture = {
  graficaId: string;
  criadorId: string; // Orcamento.usuarioId — quem "digitou" o orçamento
  vendedorClienteId: string; // Cliente.vendedorId — quem efetivamente atende o cliente
  orcamentoId: string;
};

// Dois usuários com percentuais DISTINTOS de propósito — se a comissão
// nascer da pessoa errada, o percentualAplicado/valorComissao também bate
// errado, tornando o teste sensível a um bug de origem trocada, não só ao
// id gravado.
async function criarFixture(opts: {
  comissaoSegueVendedorDoCliente: boolean;
  clienteTemVendedor: boolean;
}): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Vendedor Cliente ${s}`, slug: `teste-vendedor-cliente-${s}` },
  });
  await prisma.parametrosGrafica.create({
    data: { graficaId: grafica.id, comissaoSegueVendedorDoCliente: opts.comissaoSegueVendedorDoCliente },
  });

  // ADMIN (não OPERADOR): OPERADOR exige PermissaoUsuario.ORCAMENTO.podeEditar
  // explícita (ver podeEditarModulo em src/lib/auth/permissoes.ts), que este
  // fixture não cria — mesmo padrão de actions.comissao-custo.test.ts.
  const criador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Criador ${s}`,
      email: `criador-vendedor-${s}@example.com`,
      senhaHash: "x",
      papel: "ADMIN",
      comissaoPercent: 0.05,
    },
  });
  const vendedorCliente = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Vendedor Cliente ${s}`,
      email: `vendedor-cliente-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      comissaoPercent: 0.2,
    },
  });

  const cliente = await prisma.cliente.create({
    data: {
      graficaId: grafica.id,
      nome: `Cliente ${s}`,
      vendedorId: opts.clienteTemVendedor ? vendedorCliente.id : null,
    },
  });

  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: 1000, precoCompra: 1 },
  });

  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: cliente.id,
      usuarioId: criador.id,
      status: "ENVIADO",
      total: 1000,
    },
  });
  await prisma.orcamentoItem.create({
    data: {
      orcamentoId: orcamento.id,
      itemGraficaId: itemGrafica.id,
      quantidade: 1,
      precoUnitario: 1000,
      precoTotal: 1000,
    },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    criadorId: criador.id,
    vendedorClienteId: vendedorCliente.id,
    orcamentoId: orcamento.id,
  };
}

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

describe("aprovação de orçamento — vendedor do cliente na comissão (achado A8)", () => {
  it(
    "flag desligada (default): Comissao.usuarioId continua sendo Orcamento.usuarioId, mesmo com Cliente.vendedorId preenchido",
    async () => {
      const f = await criarFixture({
        comissaoSegueVendedorDoCliente: false,
        clienteTemVendedor: true,
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.criadorId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUniqueOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(comissao.usuarioId).toBe(f.criadorId);
      expect(Number(comissao.percentualAplicado)).toBeCloseTo(0.05, 4);
      expect(Number(comissao.valorComissao)).toBeCloseTo(50, 2);
    },
    TIMEOUT_MS
  );

  it(
    "flag ligada + cliente com vendedor: Comissao.usuarioId reflete Cliente.vendedorId, não quem criou o orçamento",
    async () => {
      const f = await criarFixture({
        comissaoSegueVendedorDoCliente: true,
        clienteTemVendedor: true,
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.criadorId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUniqueOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(comissao.usuarioId).toBe(f.vendedorClienteId);
      expect(comissao.usuarioId).not.toBe(f.criadorId);
      expect(Number(comissao.percentualAplicado)).toBeCloseTo(0.2, 4);
      expect(Number(comissao.valorComissao)).toBeCloseTo(200, 2);
    },
    TIMEOUT_MS
  );

  it(
    "flag ligada + cliente SEM vendedor: cai de volta pra Orcamento.usuarioId (mesmo fallback de hoje)",
    async () => {
      const f = await criarFixture({
        comissaoSegueVendedorDoCliente: true,
        clienteTemVendedor: false,
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.criadorId } })) as never
      );

      const resultado = await atualizarStatusOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, novoStatus: "APROVADO" })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUniqueOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(comissao.usuarioId).toBe(f.criadorId);
      expect(Number(comissao.percentualAplicado)).toBeCloseTo(0.05, 4);
    },
    TIMEOUT_MS
  );
});
