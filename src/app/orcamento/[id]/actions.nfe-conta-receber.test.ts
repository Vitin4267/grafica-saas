import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.condicao-pagamento.test.ts) — cobre o achado R1 da
// auditoria de abrangência (Parte 7, 2026-09-03): gatilho EMISSAO_NOTA de
// gerarContasReceberDaEmissaoNota (ver src/lib/condicao-pagamento.ts),
// plumbado tanto em emitirNotaFiscal (autorização síncrona) quanto em
// atualizarStatusNotaFiscal (autorização assíncrona, via reconsulta depois
// de PROCESSANDO). O provedor externo (Focus NFe) é mockado via
// global.fetch — não há chamada de rede de verdade.
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
import { emitirNotaFiscal, atualizarStatusNotaFiscal } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarCondicao(
  graficaId: string,
  opts: {
    nome: string;
    ancora: "APROVACAO" | "EMISSAO_NOTA" | "ENTREGA" | "OUTRO";
    parcelas: { ordem: number; percentual: number; diasAposAncora: number }[];
  }
) {
  return prisma.condicaoPagamento.create({
    data: { graficaId, nome: opts.nome, ancora: opts.ancora, parcelas: { create: opts.parcelas } },
  });
}

// Fixture completa (gráfica + dados fiscais Simples Nacional + cliente com
// endereço/documento + item com NCM) — o mínimo que verificarProntidaoFiscal
// (src/lib/nota-fiscal.ts) exige antes de deixar emitirNotaFiscal/
// atualizarStatusNotaFiscal chegarem até a chamada da Focus NFe.
async function criarFixtureFiscal(opts: { total: number; condicaoPagamentoId?: string | null }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste NFe ContaReceber ${s}`, slug: `teste-nfe-conta-receber-${s}` },
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
      // regimeTributario default SIMPLES_NACIONAL — não precisa dos campos
      // de CST-ICMS pra ficar "pronto" (ver verificarProntidaoFiscal).
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
      email: `dono-nfe-conta-receber-${s}@example.com`,
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
      condicaoPagamentoId: opts.condicaoPagamentoId ?? null,
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
  return { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, orcamentoId: orcamento.id, dono };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

// Simula a resposta HTTP da Focus NFe — resposta.status aqui é o STATUS HTTP
// (200), não confundir com o campo `status` do corpo JSON (a situação da
// nota: processando_autorizacao/autorizado/...), que é o que
// mapearResposta/emitirNfe interpretam.
function respostaFocusNfe(corpoJson: Record<string, unknown>, httpStatus = 200): Response {
  return {
    ok: httpStatus < 400,
    status: httpStatus,
    json: async () => corpoJson,
  } as Response;
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
    await prisma.condicaoPagamentoParcela.deleteMany({ where: { condicaoPagamento: { graficaId } } });
    await prisma.condicaoPagamento.deleteMany({ where: { graficaId } });
    await prisma.dadosFiscaisGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
  vi.unstubAllGlobals();
}, TIMEOUT_MS);

describe("emissão de NF-e — geração automática de ContaReceber (achado R1)", () => {
  it(
    "condição com âncora EMISSAO_NOTA: nada é gerado pela aprovação, só depois da NF-e vir autorizada na própria chamada de emissão",
    async () => {
      const f = await criarFixtureFiscal({ total: 300 });
      const condicao = await criarCondicao(f.graficaId, {
        nome: "1x faturado 30 dias",
        ancora: "EMISSAO_NOTA",
        parcelas: [{ ordem: 1, percentual: 100, diasAposAncora: 30 }],
      });
      await prisma.orcamento.update({ where: { id: f.orcamentoId }, data: { condicaoPagamentoId: condicao.id } });

      // Nenhuma ContaReceber existe ainda — a aprovação (fora de escopo
      // deste teste, orçamento já nasce APROVADO) nunca dispara pra âncora
      // EMISSAO_NOTA.
      expect(await prisma.contaReceber.count({ where: { orcamentoId: f.orcamentoId } })).toBe(0);

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(f.dono as never);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(
          respostaFocusNfe({
            status: "autorizado",
            numero: "1001",
            serie: "1",
            chave_nfe: "35260112345678000199550010000010011234567890",
          })
        )
      );

      const resultado = await emitirNotaFiscal(null, formDataDe({ orcamentoId: f.orcamentoId }));
      expect(resultado.ok).toBe(true);

      const notaFiscal = await prisma.notaFiscal.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(notaFiscal.status).toBe("AUTORIZADA");

      const contas = await prisma.contaReceber.findMany({ where: { orcamentoId: f.orcamentoId } });
      expect(contas).toHaveLength(1);
      expect(Number(contas[0].valor)).toBeCloseTo(300, 2);
      expect(contas[0].clienteId).toBe(f.clienteId);
      expect(contas[0].descricao).toContain("1x faturado 30 dias");
    },
    TIMEOUT_MS
  );

  it(
    "emissão fica PROCESSANDO (assíncrona): ContaReceber só nasce quando atualizarStatusNotaFiscal confirma AUTORIZADA depois",
    async () => {
      const f = await criarFixtureFiscal({ total: 500 });
      const condicao = await criarCondicao(f.graficaId, {
        nome: "28/42/56 dias da emissão da nota",
        ancora: "EMISSAO_NOTA",
        parcelas: [
          { ordem: 1, percentual: 50, diasAposAncora: 28 },
          { ordem: 2, percentual: 50, diasAposAncora: 56 },
        ],
      });
      await prisma.orcamento.update({ where: { id: f.orcamentoId }, data: { condicaoPagamentoId: condicao.id } });

      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(f.dono as never);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(respostaFocusNfe({ status: "processando_autorizacao" }))
      );

      const emissao = await emitirNotaFiscal(null, formDataDe({ orcamentoId: f.orcamentoId }));
      expect(emissao.ok).toBe(true);
      expect((await prisma.notaFiscal.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } })).status).toBe(
        "PROCESSANDO"
      );
      // Ainda processando — nenhuma ContaReceber gerada.
      expect(await prisma.contaReceber.count({ where: { orcamentoId: f.orcamentoId } })).toBe(0);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(
          respostaFocusNfe({ status: "autorizado", numero: "2002", serie: "1", chave_nfe: "35260" })
        )
      );
      const consulta1 = await atualizarStatusNotaFiscal(null, formDataDe({ orcamentoId: f.orcamentoId }));
      expect(consulta1.ok).toBe(true);
      expect((await prisma.notaFiscal.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } })).status).toBe(
        "AUTORIZADA"
      );

      const contasDepoisDaPrimeiraConsulta = await prisma.contaReceber.findMany({
        where: { orcamentoId: f.orcamentoId },
        orderBy: { vencimento: "asc" },
      });
      expect(contasDepoisDaPrimeiraConsulta).toHaveLength(2);
      const somaTotal = contasDepoisDaPrimeiraConsulta.reduce((soma, c) => soma + Number(c.valor), 0);
      expect(somaTotal).toBeCloseTo(500, 2);

      // Idempotência (achado R1, item 5) — o operador pode clicar
      // "atualizar status" de novo mesmo já autorizada (reconsulta não tem
      // CAS natural, diferente da aprovação). Confirma NF-e reautorizada de
      // novo não duplica as ContaReceber já geradas.
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(
          respostaFocusNfe({ status: "autorizado", numero: "2002", serie: "1", chave_nfe: "35260" })
        )
      );
      const consulta2 = await atualizarStatusNotaFiscal(null, formDataDe({ orcamentoId: f.orcamentoId }));
      expect(consulta2.ok).toBe(true);

      const contasDepoisDaSegundaConsulta = await prisma.contaReceber.findMany({
        where: { orcamentoId: f.orcamentoId },
      });
      expect(contasDepoisDaSegundaConsulta).toHaveLength(2);
    },
    TIMEOUT_MS
  );
});
