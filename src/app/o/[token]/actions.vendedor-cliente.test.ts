import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL) —
// espelha src/app/orcamento/[id]/actions.vendedor-cliente.test.ts, mas pelo
// caminho PÚBLICO (link de aprovação sem sessão). O comentário em
// responderOrcamentoPublico já promete "mesmo comportamento do caminho
// autenticado" — este teste garante que a origem do usuarioId da comissão
// (achado A8) realmente está espelhada nos dois caminhos, não só um deles.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

// after() exige escopo de requisição real (Next.js) — fora de um handler de
// verdade (como aqui, chamando a Server Action direto de um teste), ele
// lança. O caminho autenticado nunca exercita `after` nestes testes (nenhum
// responsável por Nota Fiscal configurado nas fixtures), mas o caminho
// público chama notificarRespostaOrcamento incondicionalmente em toda
// resposta — roda o callback na hora, síncrono o bastante pro teste.
vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    fn();
  },
}));

// obterIpRequisicao lê o header via next/headers, que também exige escopo
// de requisição — mockado pra um IP fixo por teste (rate limit de resposta
// pública é por orçamento+IP, ver tentarRegistrarRespostaOrcamento).
vi.mock("@/lib/auth/ip", () => ({
  obterIpRequisicao: vi.fn(async () => "203.0.113.10"),
}));

import { responderOrcamentoPublico } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// resolverOrigemPublica prioriza APP_URL antes de cair pro fallback via
// next/headers (também sem escopo de requisição aqui) — configurada só
// durante este arquivo de teste, restaurada depois.
const APP_URL_ORIGINAL = process.env.APP_URL;
beforeAll(() => {
  process.env.APP_URL = "https://teste.example";
});
afterAll(() => {
  if (APP_URL_ORIGINAL === undefined) delete process.env.APP_URL;
  else process.env.APP_URL = APP_URL_ORIGINAL;
});

type Fixture = {
  graficaId: string;
  criadorId: string;
  vendedorClienteId: string;
  orcamentoId: string;
};

async function criarFixture(opts: {
  comissaoSegueVendedorDoCliente: boolean;
  clienteTemVendedor: boolean;
}): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Vendedor Cliente Publico ${s}`, slug: `teste-vendedor-cliente-pub-${s}` },
  });
  await prisma.assinaturaGrafica.create({
    data: { graficaId: grafica.id, status: "ATIVA" },
  });
  await prisma.parametrosGrafica.create({
    data: { graficaId: grafica.id, comissaoSegueVendedorDoCliente: opts.comissaoSegueVendedorDoCliente },
  });

  const criador = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Criador Pub ${s}`,
      email: `criador-vendedor-pub-${s}@example.com`,
      senhaHash: "x",
      papel: "OPERADOR",
      comissaoPercent: 0.05,
    },
  });
  const vendedorCliente = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Vendedor Cliente Pub ${s}`,
      email: `vendedor-cliente-pub-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
      comissaoPercent: 0.2,
    },
  });

  const cliente = await prisma.cliente.create({
    data: {
      graficaId: grafica.id,
      nome: `Cliente Pub ${s}`,
      vendedorId: opts.clienteTemVendedor ? vendedorCliente.id : null,
    },
  });

  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto Teste Pub ${s}` },
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
      linkPublicoToken: `token-vendedor-${s}`,
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
  orcamentoIdsParaLimpar.push(orcamento.id);

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
const orcamentoIdsParaLimpar: string[] = [];

afterEach(async () => {
  if (orcamentoIdsParaLimpar.length > 0) {
    await prisma.tentativaRespostaOrcamento.deleteMany({
      where: { orcamentoId: { in: orcamentoIdsParaLimpar } },
    });
    orcamentoIdsParaLimpar.length = 0;
  }
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
    await prisma.assinaturaGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("aprovação pública de orçamento — vendedor do cliente na comissão (achado A8)", () => {
  it(
    "flag desligada (default): Comissao.usuarioId continua sendo Orcamento.usuarioId, mesmo com Cliente.vendedorId preenchido",
    async () => {
      const f = await criarFixture({
        comissaoSegueVendedorDoCliente: false,
        clienteTemVendedor: true,
      });
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });

      const resultado = await responderOrcamentoPublico(
        null,
        formDataDe({
          token: orcamento.linkPublicoToken!,
          decisao: "APROVADO",
          nome: "Cliente Teste",
        })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUniqueOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(comissao.usuarioId).toBe(f.criadorId);
      expect(Number(comissao.percentualAplicado)).toBeCloseTo(0.05, 4);
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
      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });

      const resultado = await responderOrcamentoPublico(
        null,
        formDataDe({
          token: orcamento.linkPublicoToken!,
          decisao: "APROVADO",
          nome: "Cliente Teste",
        })
      );
      expect(resultado.ok).toBe(true);

      const comissao = await prisma.comissao.findUniqueOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(comissao.usuarioId).toBe(f.vendedorClienteId);
      expect(comissao.usuarioId).not.toBe(f.criadorId);
      expect(Number(comissao.percentualAplicado)).toBeCloseTo(0.2, 4);
    },
    TIMEOUT_MS
  );
});
