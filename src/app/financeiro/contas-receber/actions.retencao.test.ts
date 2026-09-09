import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.taxa-pagamento.test.ts) — cobre o achado A9 da
// Parte 4 da auditoria de abrangência (2026-09-09), versão DECLARATIVA de
// retenção de imposto na fonte. FALHA ESPERADA até a migration
// 20260909140000_retencao_conta_receber ser aplicada ao banco.
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
import {
  criarRetencaoContaReceber,
  excluirRetencaoContaReceber,
  registrarBaixaContaReceber,
} from "./actions";
import { saldoContaReceber } from "@/lib/baixa-financeira";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture(opts: { total: number }) {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Retencao ${s}`, slug: `teste-retencao-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}`, retemImpostos: true, tipoTomador: "PJ_PRIVADA" },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-retencao-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "APROVADO", total: opts.total },
  });
  const conta = await prisma.contaReceber.create({
    data: {
      graficaId: grafica.id,
      orcamentoId: orcamento.id,
      clienteId: cliente.id,
      descricao: "Parcela única",
      valor: opts.total,
      vencimento: new Date("2026-09-01T00:00:00Z"),
    },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, usuarioId: dono.id, orcamentoId: orcamento.id, contaId: conta.id, clienteId: cliente.id };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

async function logarComo(usuarioId: string) {
  vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
    (await prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } })) as never
  );
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.retencaoContaReceber.deleteMany({ where: { graficaId } });
    await prisma.baixaContaReceber.deleteMany({ where: { contaReceber: { graficaId } } });
    await prisma.contaReceber.deleteMany({ where: { graficaId } });
    await prisma.pagamento.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("criarRetencaoContaReceber / excluirRetencaoContaReceber (achado A9 da Parte 4)", () => {
  it(
    "cria uma linha de retenção e soma em ContaReceber.valorRetencoes",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await criarRetencaoContaReceber(
        null,
        formDataDe({ contaReceberId: f.contaId, tributo: "ISS", percentual: "5", valor: "50" })
      );

      expect(resultado.ok).toBe(true);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(Number(conta.valorRetencoes)).toBe(50);
      const linhas = await prisma.retencaoContaReceber.findMany({ where: { contaReceberId: f.contaId } });
      expect(linhas).toHaveLength(1);
      expect(linhas[0].tributo).toBe("ISS");
      expect(Number(linhas[0].percentual)).toBe(5);
      expect(Number(linhas[0].valor)).toBe(50);
    },
    TIMEOUT_MS
  );

  it(
    "duas linhas (ISS + IRRF) somam em ContaReceber.valorRetencoes — líquido esperado = bruto − soma",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      await criarRetencaoContaReceber(
        null,
        formDataDe({ contaReceberId: f.contaId, tributo: "ISS", percentual: "5", valor: "50" })
      );
      await criarRetencaoContaReceber(
        null,
        formDataDe({ contaReceberId: f.contaId, tributo: "IRRF", percentual: "1.5", valor: "15" })
      );

      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(Number(conta.valorRetencoes)).toBe(65);
      const liquidoEsperado = Number(conta.valor) - Number(conta.valorRetencoes);
      expect(liquidoEsperado).toBe(935);
      const linhas = await prisma.retencaoContaReceber.findMany({ where: { contaReceberId: f.contaId } });
      expect(linhas).toHaveLength(2);
    },
    TIMEOUT_MS
  );

  it(
    "tributo=OUTRO sem tributoOutro é rejeitado, nenhuma linha criada e valorRetencoes continua 0",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await criarRetencaoContaReceber(
        null,
        formDataDe({ contaReceberId: f.contaId, tributo: "OUTRO", percentual: "2", valor: "20" })
      );

      expect(resultado.ok).toBe(false);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(Number(conta.valorRetencoes)).toBe(0);
      const linhas = await prisma.retencaoContaReceber.findMany({ where: { contaReceberId: f.contaId } });
      expect(linhas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "excluirRetencaoContaReceber remove a linha e subtrai o valor de ContaReceber.valorRetencoes",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      await criarRetencaoContaReceber(
        null,
        formDataDe({ contaReceberId: f.contaId, tributo: "ISS", percentual: "5", valor: "50" })
      );
      const linha = await prisma.retencaoContaReceber.findFirstOrThrow({ where: { contaReceberId: f.contaId } });

      const resultado = await excluirRetencaoContaReceber(null, formDataDe({ id: linha.id }));

      expect(resultado.ok).toBe(true);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(Number(conta.valorRetencoes)).toBe(0);
      const linhas = await prisma.retencaoContaReceber.findMany({ where: { contaReceberId: f.contaId } });
      expect(linhas).toHaveLength(0);
    },
    TIMEOUT_MS
  );

  it(
    "isolamento de tenant: usuário de outra gráfica não consegue criar nem excluir retenção de conta alheia",
    async () => {
      const f1 = await criarFixture({ total: 1000 });
      const f2 = await criarFixture({ total: 500 });

      // Cria uma retenção legítima na conta de f1, logado como dono de f1.
      await logarComo(f1.usuarioId);
      await criarRetencaoContaReceber(
        null,
        formDataDe({ contaReceberId: f1.contaId, tributo: "ISS", percentual: "5", valor: "50" })
      );
      const linhaDeF1 = await prisma.retencaoContaReceber.findFirstOrThrow({ where: { contaReceberId: f1.contaId } });

      // Logado como dono de f2, tenta mexer na conta/retenção de f1.
      await logarComo(f2.usuarioId);
      const resultadoCriar = await criarRetencaoContaReceber(
        null,
        formDataDe({ contaReceberId: f1.contaId, tributo: "IRRF", percentual: "1.5", valor: "15" })
      );
      expect(resultadoCriar.ok).toBe(false);

      const resultadoExcluir = await excluirRetencaoContaReceber(null, formDataDe({ id: linhaDeF1.id }));
      expect(resultadoExcluir.ok).toBe(false);

      // Nada mudou na conta/retenção de f1.
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f1.contaId } });
      expect(Number(conta.valorRetencoes)).toBe(50);
      const linhas = await prisma.retencaoContaReceber.findMany({ where: { contaReceberId: f1.contaId } });
      expect(linhas).toHaveLength(1);
    },
    TIMEOUT_MS
  );
});

describe("regressão zero — baixa de ContaReceber ignora valorRetencoes/RetencaoContaReceber por completo", () => {
  it(
    "sem nenhuma retenção: registrarBaixaContaReceber continua fechando a conta com o valor cheio, exatamente como antes do achado A9",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      const resultado = await registrarBaixaContaReceber(null, formDataDe({ id: f.contaId, forma: "PIX" }));

      expect(resultado.ok).toBe(true);
      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(conta.status).toBe("RECEBIDO");
      expect(Number(conta.valorRetencoes)).toBe(0);
    },
    TIMEOUT_MS
  );

  it(
    "com uma retenção lançada: saldoContaReceber ainda considera o valor CHEIO (valorRetencoes é só informativo, nunca subtraído do saldo)",
    async () => {
      const f = await criarFixture({ total: 1000 });
      await logarComo(f.usuarioId);

      await criarRetencaoContaReceber(
        null,
        formDataDe({ contaReceberId: f.contaId, tributo: "ISS", percentual: "5", valor: "50" })
      );

      const conta = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      const saldo = await saldoContaReceber(prisma, conta);
      // Saldo em aberto continua 1000 (o valor CHEIO da conta) — a
      // retenção de 50 não é subtraída automaticamente de nada, conforme
      // decisão deliberada de manter a conciliação automática fora de
      // escopo (ver comentário em ContaReceber.valorRetencoes no schema).
      expect(saldo.toNumber()).toBe(1000);

      // E a baixa em valor cheio (1000) ainda fecha a conta normalmente —
      // registrar uma retenção não trava nem muda o comportamento da baixa.
      const resultado = await registrarBaixaContaReceber(null, formDataDe({ id: f.contaId, forma: "PIX" }));
      expect(resultado.ok).toBe(true);
      const contaFinal = await prisma.contaReceber.findUniqueOrThrow({ where: { id: f.contaId } });
      expect(contaFinal.status).toBe("RECEBIDO");
      expect(Number(contaFinal.valorRetencoes)).toBe(50);
    },
    TIMEOUT_MS
  );
});
