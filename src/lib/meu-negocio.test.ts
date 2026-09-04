import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { buscarVisaoGeralNegocio } from "@/lib/meu-negocio";

// Teste de INTEGRAÇÃO — cobre os achados E1 e E2 da Parte 7 da auditoria de
// abrangência (pesquisa-abrangencia-modulos.md): dashboard mostra "Pipeline
// de produção" mesmo pra quem não produz, e link "Produção" no menu oferecido
// mesmo pra revenda pura. O sinal temAlgumPedido discrimina gráficas com uso
// real de produção vs. revenda pura que nunca criou nenhum Pedido.

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
  unstable_cache: (fn: unknown) => fn,
}));

const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  usuarioDonoId: string;
};

async function criarFixture(): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Meu Negócio ${s}`, slug: `teste-meu-negocio-${s}` },
  });
  const usuarioDono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-meu-negocio-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });

  return {
    graficaId: grafica.id,
    usuarioDonoId: usuarioDono.id,
  };
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.logAuditoria.deleteMany({ where: { graficaId } });
    // Pedido→Orcamento é RESTRICT (não CASCADE) — precisa deletar Pedido
    // antes de Orcamento, senão a FK bloqueia o delete.
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.etapaGrafica.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("buscarVisaoGeralNegocio — temAlgumPedido (E1 e E2)", () => {
  it(
    "retorna temAlgumPedido=false quando gráfica nunca teve nenhum Pedido",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      const visao = await buscarVisaoGeralNegocio(fixture.graficaId);

      expect(visao.temAlgumPedido).toBe(false);
    },
    TIMEOUT_MS
  );

  it(
    "retorna temAlgumPedido=true quando gráfica tem pelo menos um Pedido",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      // Cria um cliente
      const cliente = await prisma.cliente.create({
        data: {
          graficaId: fixture.graficaId,
          nome: "Cliente Teste",
        },
      });

      // Cria um orçamento e aprova (isso cria um Pedido via FK relacional)
      const orcamento = await prisma.orcamento.create({
        data: {
          graficaId: fixture.graficaId,
          clienteId: cliente.id,
          usuarioId: fixture.usuarioDonoId,
          status: "RASCUNHO",
          total: 1000,
        },
      });

      // Aprova o orçamento (transação que cria um Pedido associado)
      const pedido = await prisma.pedido.create({
        data: {
          graficaId: fixture.graficaId,
          orcamentoId: orcamento.id,
          status: "ARTE",
        },
      });

      // Confirma que o pedido foi criado
      expect(pedido).toBeDefined();
      expect(pedido.graficaId).toBe(fixture.graficaId);

      const visao = await buscarVisaoGeralNegocio(fixture.graficaId);

      expect(visao.temAlgumPedido).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "retorna temAlgumPedido=true mesmo quando há apenas um Pedido CANCELADO",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      // Cria um cliente
      const cliente = await prisma.cliente.create({
        data: {
          graficaId: fixture.graficaId,
          nome: "Cliente Teste",
        },
      });

      // Cria um orçamento
      const orcamento = await prisma.orcamento.create({
        data: {
          graficaId: fixture.graficaId,
          clienteId: cliente.id,
          usuarioId: fixture.usuarioDonoId,
          status: "RASCUNHO",
          total: 1000,
        },
      });

      // Cria um Pedido e depois o cancela
      const pedido = await prisma.pedido.create({
        data: {
          graficaId: fixture.graficaId,
          orcamentoId: orcamento.id,
          status: "CANCELADO",
        },
      });

      expect(pedido.status).toBe("CANCELADO");

      const visao = await buscarVisaoGeralNegocio(fixture.graficaId);

      // temAlgumPedido deve ser true pois verifica existência, não filtro por status
      expect(visao.temAlgumPedido).toBe(true);
    },
    TIMEOUT_MS
  );

  it(
    "retorna temAlgumPedido=true e totalPedidos=0 quando todos os pedidos estão cancelados",
    async () => {
      const fixture = await criarFixture();
      graficaIdsParaLimpar.push(fixture.graficaId);

      // Cria um cliente
      const cliente = await prisma.cliente.create({
        data: {
          graficaId: fixture.graficaId,
          nome: "Cliente Teste",
        },
      });

      // Cria múltiplos orçamentos com Pedidos cancelados
      for (let i = 0; i < 3; i++) {
        const orcamento = await prisma.orcamento.create({
          data: {
            graficaId: fixture.graficaId,
            clienteId: cliente.id,
            usuarioId: fixture.usuarioDonoId,
            status: "RASCUNHO",
            total: 1000 + i * 100,
          },
        });

        await prisma.pedido.create({
          data: {
            graficaId: fixture.graficaId,
            orcamentoId: orcamento.id,
            status: "CANCELADO",
          },
        });
      }

      const visao = await buscarVisaoGeralNegocio(fixture.graficaId);

      // temAlgumPedido é true (pedidos existem), mas totalPedidos pode ser 0
      // (dependendo se a query de pipelineProducao filtra cancelados)
      expect(visao.temAlgumPedido).toBe(true);
      // O totalPedidos não conta cancelados (ver meu-negocio.ts linha 232)
      expect(visao.totalPedidos).toBe(0);
    },
    TIMEOUT_MS
  );
});
