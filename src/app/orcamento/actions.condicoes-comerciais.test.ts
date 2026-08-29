import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/orcamento/[id]/actions.desconto.test.ts) — cobre a
// parte de PRÉ-PREENCHIMENTO do achado A6 da Parte 5 da auditoria de
// abrangência: buscarCondicoesComerciaisCliente deriva a sugestão de
// "Condições de pagamento" da Calculadora a partir de
// Cliente.prazoPagamentoPadraoDias/formaPagamentoPreferida, sem nunca
// devolver o resto do cadastro do cliente (a lista que alimenta o <select>
// de cliente na Calculadora é deliberadamente {id, nome} só, ver comentário
// em src/app/orcamento/page.tsx — esta função é a única fresta autorizada a
// devolver mais que isso, e só pro cliente selecionado).
//
// SÓ RODA DE VERDADE depois que a migration
// prisma/migrations/20260828120000_cliente_dados_comerciais/migration.sql
// tiver sido aplicada no banco — ver relatório final da tarefa.
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
import { buscarCondicoesComerciaisCliente } from "./actions";

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const graficaIdsParaLimpar: string[] = [];

async function criarGraficaComUsuario() {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Condicoes Comerciais ${s}`, slug: `teste-condicoes-comerciais-${s}` },
  });
  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-condicoes-comerciais-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  graficaIdsParaLimpar.push(grafica.id);
  return { grafica, dono };
}

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
  vi.mocked(exigirUsuarioAutenticado).mockReset();
}, TIMEOUT_MS);

describe("buscarCondicoesComerciaisCliente (pré-preenchimento do achado A6 da Parte 5)", () => {
  it(
    "cliente com prazo e forma de pagamento cadastrados: sugere os dois combinados",
    async () => {
      const { grafica, dono } = await criarGraficaComUsuario();
      const cliente = await prisma.cliente.create({
        data: {
          graficaId: grafica.id,
          nome: "Cliente com prazo",
          prazoPagamentoPadraoDias: 28,
          formaPagamentoPreferida: "BOLETO",
        },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(dono as never);

      const sugestao = await buscarCondicoesComerciaisCliente(cliente.id);

      expect(sugestao.condicoesPagamento).toBe("Boleto, 28 dias");
    },
    TIMEOUT_MS
  );

  it(
    "cliente só com prazo cadastrado: sugere só o prazo",
    async () => {
      const { grafica, dono } = await criarGraficaComUsuario();
      const cliente = await prisma.cliente.create({
        data: { graficaId: grafica.id, nome: "Cliente só prazo", prazoPagamentoPadraoDias: 30 },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(dono as never);

      const sugestao = await buscarCondicoesComerciaisCliente(cliente.id);

      expect(sugestao.condicoesPagamento).toBe("30 dias");
    },
    TIMEOUT_MS
  );

  it(
    "prazo zero é tratado como à vista, não '0 dias'",
    async () => {
      const { grafica, dono } = await criarGraficaComUsuario();
      const cliente = await prisma.cliente.create({
        data: { graficaId: grafica.id, nome: "Cliente à vista", prazoPagamentoPadraoDias: 0 },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(dono as never);

      const sugestao = await buscarCondicoesComerciaisCliente(cliente.id);

      expect(sugestao.condicoesPagamento).toBe("à vista");
    },
    TIMEOUT_MS
  );

  it(
    "cliente sem prazo nem forma cadastrados: sem sugestão (comportamento de hoje, campo nasce vazio)",
    async () => {
      const { grafica, dono } = await criarGraficaComUsuario();
      const cliente = await prisma.cliente.create({
        data: { graficaId: grafica.id, nome: "Cliente sem dados comerciais" },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(dono as never);

      const sugestao = await buscarCondicoesComerciaisCliente(cliente.id);

      expect(sugestao.condicoesPagamento).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "isolamento de tenant: cliente de OUTRA gráfica não vaza sugestão nenhuma",
    async () => {
      const { dono } = await criarGraficaComUsuario();
      const { grafica: outraGrafica } = await criarGraficaComUsuario();
      const clienteDeOutraGrafica = await prisma.cliente.create({
        data: {
          graficaId: outraGrafica.id,
          nome: "Cliente de outra gráfica",
          prazoPagamentoPadraoDias: 45,
          formaPagamentoPreferida: "PIX",
        },
      });
      vi.mocked(exigirUsuarioAutenticado).mockResolvedValue(dono as never);

      const sugestao = await buscarCondicoesComerciaisCliente(clienteDeOutraGrafica.id);

      expect(sugestao.condicoesPagamento).toBeNull();
    },
    TIMEOUT_MS
  );
});
