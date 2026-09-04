import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.nfe-conta-receber.test.ts) — cobre o achado R3 da
// auditoria de abrangência (Parte 2/Produção, rodada 20, 2026-09-03): emissão
// da NF-e de REMESSA (CFOP 5901/6901) de uma EtapaTerceirizada direto do
// sistema via Focus NFe. O provedor externo é mockado via global.fetch — não
// há chamada de rede de verdade.
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
import { emitirNfeRemessaTerceirizacao } from "./terceirizacao-nfe-actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const graficaIdsParaLimpar: string[] = [];

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

function respostaFocusNfe(corpoJson: unknown, httpStatus = 200): Response {
  return {
    ok: httpStatus < 400,
    status: httpStatus,
    json: async () => corpoJson,
  } as Response;
}

// Fixture completa: gráfica + dados fiscais + pedido + EtapaTerceirizada com
// um Fornecedor CADASTRADO — o mínimo pra emitirNfeRemessaTerceirizacao
// chegar até a chamada da Focus NFe. `fornecedorCompleto=false` cobre o
// gate "fornecedor sem CNPJ/endereço".
async function criarFixture(opts: { fornecedorCompleto: boolean }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste NFe Terceirizacao ${s}`, slug: `teste-nfe-terceirizacao-${s}` },
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
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-nfe-terceirizacao-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const fornecedor = await prisma.fornecedor.create({
    data: {
      graficaId: grafica.id,
      nome: `Laminações Fulano ${s}`,
      ...(opts.fornecedorCompleto
        ? {
            documento: "98765432000188",
            enderecoLogradouro: "Rua do Terceiro",
            enderecoNumero: "50",
            enderecoBairro: "Industrial",
            enderecoMunicipio: "Guarulhos",
            enderecoUf: "SP",
            enderecoCep: "07000000",
          }
        : {}),
    },
  });
  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "APROVADO", total: 500 },
  });
  const pedido = await prisma.pedido.create({
    data: { graficaId: grafica.id, orcamentoId: orcamento.id, status: "ACABAMENTO" },
  });
  const etapa = await prisma.etapaTerceirizada.create({
    data: { graficaId: grafica.id, pedidoId: pedido.id, status: "ACABAMENTO", fornecedorId: fornecedor.id },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, dono, fornecedorId: fornecedor.id, etapaId: etapa.id };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    await prisma.etapaTerceirizada.deleteMany({ where: { graficaId } });
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.fornecedor.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.dadosFiscaisGrafica.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
  vi.unstubAllGlobals();
}, TIMEOUT_MS);

describe("emitirNfeRemessaTerceirizacao (achado R3)", () => {
  it(
    "fornecedor cadastrado sem CNPJ/endereço: rejeitado ANTES de chamar a Focus NFe, nenhuma escrita",
    async () => {
      const f = await criarFixture({ fornecedorCompleto: false });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(f.dono as never);
      const fetchEspiao = vi.fn();
      vi.stubGlobal("fetch", fetchEspiao);

      const resultado = await emitirNfeRemessaTerceirizacao(
        null,
        formDataDe({
          etapaId: f.etapaId,
          descricao: "Chapas de papel",
          ncm: "48109000",
          icmsSituacaoTributaria: "400",
          valor: "300",
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("CNPJ/CPF e endereço completos");
      expect(fetchEspiao).not.toHaveBeenCalled();
      const etapa = await prisma.etapaTerceirizada.findUniqueOrThrow({ where: { id: f.etapaId } });
      expect(etapa.remessaNfeStatus).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "fornecedor livre (nome digitado, sem fornecedorId): rejeitado com mensagem específica",
    async () => {
      const f = await criarFixture({ fornecedorCompleto: true });
      // Recria a etapa como se fosse fornecedor livre (fornecedorId null).
      await prisma.etapaTerceirizada.update({
        where: { id: f.etapaId },
        data: { fornecedorId: null, fornecedorNome: "Terceiro sem cadastro" },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(f.dono as never);

      const resultado = await emitirNfeRemessaTerceirizacao(
        null,
        formDataDe({
          etapaId: f.etapaId,
          descricao: "Chapas de papel",
          ncm: "48109000",
          icmsSituacaoTributaria: "400",
          valor: "300",
        })
      );

      expect(resultado.ok).toBe(false);
      expect(resultado.mensagem).toContain("fornecedor cadastrado");
    },
    TIMEOUT_MS
  );

  it(
    "fornecedor completo + dados fiscais completos + Focus NFe autoriza: grava remessaNfe* estruturado, notaRemessa e LogAuditoria",
    async () => {
      const f = await criarFixture({ fornecedorCompleto: true });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(f.dono as never);
      const fetchEspiao = vi.fn().mockResolvedValueOnce(
        respostaFocusNfe({
          status: "autorizado",
          numero: "5001",
          serie: "1",
          chave_nfe: "35260112345678000199550010000050011234567890",
        })
      );
      vi.stubGlobal("fetch", fetchEspiao);

      const resultado = await emitirNfeRemessaTerceirizacao(
        null,
        formDataDe({
          etapaId: f.etapaId,
          descricao: "Chapas de papel cartão pra laminação",
          ncm: "48109000",
          icmsSituacaoTributaria: "400",
          valor: "300",
        })
      );

      expect(resultado.ok).toBe(true);
      expect(fetchEspiao).toHaveBeenCalledTimes(1);

      // O CFOP calculado (mesma UF: SP=SP) deve ter ido no payload.
      const [, opcoesFetch] = fetchEspiao.mock.calls[0];
      const corpo = JSON.parse((opcoesFetch as RequestInit).body as string);
      expect(corpo.items[0].cfop).toBe("5901");
      expect(corpo.natureza_operacao).toBe("Remessa para industrialização por encomenda");

      const etapa = await prisma.etapaTerceirizada.findUniqueOrThrow({ where: { id: f.etapaId } });
      expect(etapa.remessaNfeStatus).toBe("AUTORIZADA");
      expect(etapa.remessaNfeNumero).toBe("5001");
      expect(etapa.remessaNfeChaveAcesso).toBe("35260112345678000199550010000050011234567890");
      expect(etapa.notaRemessa).toBe("5001");

      const logs = await prisma.logAuditoria.findMany({ where: { graficaId: f.graficaId } });
      expect(logs).toHaveLength(1);
      expect(logs[0].acao).toBe("etapa_terceirizada.emitir_nfe_remessa");
    },
    TIMEOUT_MS
  );

  it(
    "Focus NFe rejeita (HTTP 422): grava REJEITADA com a mensagem de erro, nunca preenche notaRemessa",
    async () => {
      const f = await criarFixture({ fornecedorCompleto: true });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(f.dono as never);
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(
          respostaFocusNfe([{ codigo: "erro_validacao", mensagem: "NCM inválido" }], 422)
        )
      );

      const resultado = await emitirNfeRemessaTerceirizacao(
        null,
        formDataDe({
          etapaId: f.etapaId,
          descricao: "Chapas de papel",
          ncm: "00000000",
          icmsSituacaoTributaria: "400",
          valor: "300",
        })
      );

      expect(resultado.ok).toBe(true); // a Server Action em si não falha — persiste o status REJEITADA
      const etapa = await prisma.etapaTerceirizada.findUniqueOrThrow({ where: { id: f.etapaId } });
      expect(etapa.remessaNfeStatus).toBe("REJEITADA");
      expect(etapa.remessaNfeMensagemErro).toBe("NCM inválido");
      expect(etapa.notaRemessa).toBeNull();
    },
    TIMEOUT_MS
  );
});
