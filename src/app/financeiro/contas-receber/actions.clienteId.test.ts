import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de actions.baixa-parcial.test.ts) — cobre o achado A10 da
// Parte 5 da auditoria de abrangência (2026-08-30): o caminho MANUAL de
// criação de ContaReceber (criarContaReceber) também precisa preencher
// clienteId a partir do orçamento, igual ao caminho automático
// (gerarContasReceberDaAprovacao, coberto em
// src/app/orcamento/[id]/actions.condicao-pagamento.test.ts). FALHA ESPERADA
// até a migration 20260830160000_historico_financeiro_cliente ser aplicada
// ao banco (coluna contas_a_receber.clienteId ainda não existe).
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
import { criarContaReceber } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarFixture() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste ContaReceber ClienteId ${s}`, slug: `teste-conta-receber-cliente-id-${s}` },
  });
  const cliente = await prisma.cliente.create({
    data: { graficaId: grafica.id, nome: `Cliente ${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-conta-receber-cliente-id-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, status: "APROVADO", total: 300 },
  });

  graficaIdsParaLimpar.push(grafica.id);
  return { graficaId: grafica.id, clienteId: cliente.id, usuarioId: dono.id, orcamentoId: orcamento.id };
}

function formDataDe(campos: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.contaReceber.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("criarContaReceber — preenchimento de clienteId (achado A10 da Parte 5)", () => {
  it(
    "cadastro manual de conta a receber preenche clienteId a partir do orçamento",
    async () => {
      const f = await criarFixture();
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(
        (await prisma.usuario.findUniqueOrThrow({ where: { id: f.usuarioId } })) as never
      );

      const resultado = await criarContaReceber(
        null,
        formDataDe({
          orcamentoId: f.orcamentoId,
          descricao: "Entrada",
          valor: "150",
          vencimento: "2026-10-01",
        })
      );

      expect(resultado.ok).toBe(true);
      const conta = await prisma.contaReceber.findFirstOrThrow({ where: { orcamentoId: f.orcamentoId } });
      expect(conta.clienteId).toBe(f.clienteId);
    },
    TIMEOUT_MS
  );
});
