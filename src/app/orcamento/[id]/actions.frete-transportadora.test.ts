import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.nfe-conta-receber.test.ts/actions.vendedor-cliente.
// test.ts) — cobre o achado F3 da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, Parte 7): persistência de
// Orcamento.transportadoraId/valorFrete via editarDadosGeraisOrcamento, e
// valor_frete da NF-e refletindo Orcamento.valorFrete (com e sem valor
// preenchido). O provedor externo (Focus NFe) é mockado via global.fetch —
// não há chamada de rede de verdade.
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

vi.mock("next/server", () => ({
  after: (fn: () => unknown) => {
    fn();
  },
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
import { editarDadosGeraisOrcamento, emitirNotaFiscal } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

function respostaFocusNfe(corpoJson: Record<string, unknown>, httpStatus = 200): Response {
  return {
    ok: httpStatus < 400,
    status: httpStatus,
    json: async () => corpoJson,
  } as Response;
}

// Fixture mínima pra editarDadosGeraisOrcamento (não exige nada fiscal).
async function criarFixtureBasica() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Frete Transportadora ${s}`, slug: `teste-frete-transportadora-${s}` },
  });
  const usuario = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Admin ${s}`,
      email: `admin-frete-${s}@example.com`,
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

// Fixture completa pra emitirNotaFiscal — mesmo mínimo exigido por
// verificarProntidaoFiscal que actions.nfe-conta-receber.test.ts já usa.
async function criarFixtureFiscal(opts: { total: number; valorFrete?: number | null }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Frete NFe ${s}`, slug: `teste-frete-nfe-${s}` },
  });
  await prisma.dadosFiscaisGrafica.create({
    data: {
      graficaId: grafica.id,
      focusNfeToken: "token-teste",
      cnpj: "12345678000199",
      razaoSocial: `Gráfica Teste ${s} LTDA`,
      enderecoLogradouro: "Rua Teste",
      enderecoNumero: "100",
      enderecoBairro: "Centro",
      enderecoMunicipio: "São Paulo",
      enderecoUf: "SP",
      enderecoCep: "01000000",
    },
  });
  const cliente = await prisma.cliente.create({
    data: {
      graficaId: grafica.id,
      nome: `Cliente ${s}`,
      documento: "12345678909",
      enderecoLogradouro: "Rua Cliente",
      enderecoNumero: "200",
      enderecoBairro: "Bairro",
      enderecoMunicipio: "São Paulo",
      enderecoUf: "SP",
      enderecoCep: "02000000",
    },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-frete-nfe-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto ${s}`, ncm: "49111090" },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id, precoVenda: opts.total, precoCompra: 1 },
  });
  const orcamento = await prisma.orcamento.create({
    data: {
      graficaId: grafica.id,
      clienteId: cliente.id,
      usuarioId: dono.id,
      status: "APROVADO",
      total: opts.total,
      valorFrete: opts.valorFrete ?? null,
    },
  });
  await prisma.orcamentoItem.create({
    data: {
      orcamentoId: orcamento.id,
      itemGraficaId: itemGrafica.id,
      quantidade: 1,
      precoUnitario: opts.total,
      precoTotal: opts.total,
    },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, orcamentoId: orcamento.id, dono };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.contaReceber.deleteMany({ where: { graficaId } });
    await prisma.notaFiscal.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.dadosFiscaisGrafica.deleteMany({ where: { graficaId } });
    await prisma.transportadora.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
  vi.unstubAllGlobals();
}, TIMEOUT_MS);

describe("editarDadosGeraisOrcamento — transportadoraId/valorFrete (achado F3)", () => {
  it(
    "salva transportadoraId + valorFrete quando uma Transportadora cadastrada é escolhida",
    async () => {
      const f = await criarFixtureBasica();
      const transportadora = await prisma.transportadora.create({
        data: { graficaId: f.graficaId, nome: "Lalamove" },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({
          orcamentoId: f.orcamentoId,
          transportadoraId: transportadora.id,
          transportadora: "Lalamove",
          valorFrete: "45.90",
        })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.transportadoraId).toBe(transportadora.id);
      expect(orcamento.transportadora).toBe("Lalamove");
      expect(Number(orcamento.valorFrete)).toBeCloseTo(45.9, 2);
    },
    TIMEOUT_MS
  );

  it(
    "transportadoraId ausente (\"\", digitação manual): grava null, transportadora texto livre continua funcionando",
    async () => {
      const f = await criarFixtureBasica();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({
          orcamentoId: f.orcamentoId,
          transportadora: "Motoboy do bairro (sem cadastro)",
        })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.transportadoraId).toBeNull();
      expect(orcamento.transportadora).toBe("Motoboy do bairro (sem cadastro)");
      expect(orcamento.valorFrete).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "transportadoraId de outra gráfica é rejeitado (isolamento multi-tenant, mesmo princípio de contatoClienteId/enderecoEntregaId)",
    async () => {
      const f1 = await criarFixtureBasica();
      const f2 = await criarFixtureBasica();
      const transportadoraDeF2 = await prisma.transportadora.create({
        data: { graficaId: f2.graficaId, nome: "Transp da Outra Grafica" },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f1.usuarioId } })) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({ orcamentoId: f1.orcamentoId, transportadoraId: transportadoraDeF2.id })
      );
      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toMatch(/transportadora.*inválida/i);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f1.orcamentoId } });
      expect(orcamento.transportadoraId).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "valorFrete com formato inválido é ignorado silenciosamente (cai em null, não bloqueia o resto do formulário)",
    async () => {
      const f = await criarFixtureBasica();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await editarDadosGeraisOrcamento(
        null,
        formDataDe({ orcamentoId: f.orcamentoId, valorFrete: "abacate", vendedor: "Fulano" })
      );
      expect(resultado.ok).toBe(true);

      const orcamento = await prisma.orcamento.findUniqueOrThrow({ where: { id: f.orcamentoId } });
      expect(orcamento.valorFrete).toBeNull();
      expect(orcamento.vendedor).toBe("Fulano");
    },
    TIMEOUT_MS
  );
});

describe("emissão de NF-e — valor_frete reflete Orcamento.valorFrete (achado F3)", () => {
  it(
    "Orcamento.valorFrete preenchido: valor_frete da NF-e reflete o valor, não '0'",
    async () => {
      const f = await criarFixtureFiscal({ total: 300, valorFrete: 25.5 });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(f.dono as never);
      const fetchMock = vi.fn().mockResolvedValueOnce(
        respostaFocusNfe({ status: "autorizado", numero: "4001", serie: "1", chave_nfe: "35260" })
      );
      vi.stubGlobal("fetch", fetchMock);

      const resultado = await emitirNotaFiscal(null, formDataDe({ orcamentoId: f.orcamentoId }));
      expect(resultado.ok).toBe(true);

      const corpoEnviado = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(corpoEnviado.valor_frete).toBe("25.50");
    },
    TIMEOUT_MS
  );

  it(
    "Orcamento.valorFrete ausente (null): valor_frete da NF-e cai em '0' — regressão zero do comportamento de sempre",
    async () => {
      const f = await criarFixtureFiscal({ total: 300, valorFrete: null });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(f.dono as never);
      const fetchMock = vi.fn().mockResolvedValueOnce(
        respostaFocusNfe({ status: "autorizado", numero: "4002", serie: "1", chave_nfe: "35260" })
      );
      vi.stubGlobal("fetch", fetchMock);

      const resultado = await emitirNotaFiscal(null, formDataDe({ orcamentoId: f.orcamentoId }));
      expect(resultado.ok).toBe(true);

      const corpoEnviado = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(corpoEnviado.valor_frete).toBe("0");
    },
    TIMEOUT_MS
  );
});
