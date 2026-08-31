import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";

// after() (next/server) lança "called outside a request scope" fora de uma
// requisição Next.js de verdade — mesmo motivo de
// alerta-prazo-email.test.ts mockar next/server. Roda o callback na hora
// (síncrono) pra poder asserir as chamadas de dispararEventoEmail sem
// precisar de sleep/poll no teste.
vi.mock("next/server", () => ({ after: (tarefa: () => void) => tarefa() }));

// dispararEventoEmail de verdade tentaria bater em EMAIL_WEBHOOK_URL (ausente
// no ambiente de teste) — substituído por um spy que só registra a chamada,
// mesmo padrão de alerta-prazo-email.test.ts.
vi.mock("@/lib/email/webhook-email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email/webhook-email")>();
  return { ...real, dispararEventoEmail: vi.fn(async () => true) };
});

import { dispararEventoEmail } from "@/lib/email/webhook-email";
import { verificarEDispararAlertaEstoque } from "./alerta-estoque";

const dispararEventoEmailMock = vi.mocked(dispararEventoEmail);

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL),
// mesmo padrão de alerta-prazo-email.test.ts — cobre o roteamento por
// ResponsavelAdministrativo (área COMPRAS, achado A9 da auditoria de
// abrangência, restante pendente): gráfica sem responsável cadastrado cai
// nos DONOs (comportamento de hoje); gráfica com responsável cadastrado
// manda só pra ele, sem os DONOs.
const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Fixture = {
  graficaId: string;
  itemGraficaId: string;
  donoEmail: string;
  responsavelComprasEmail?: string;
};

async function criarFixture(opts: { responsavelCompras?: boolean }): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Alerta Estoque ${s}`, slug: `teste-alerta-estoque-${s}` },
  });

  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });

  let responsavelComprasEmail: string | undefined;
  if (opts.responsavelCompras) {
    const responsavel = await prisma.usuario.create({
      data: {
        graficaId: grafica.id,
        nome: `Comprador ${s}`,
        email: `comprador-${s}@example.com`,
        senhaHash: "x",
        papel: "OPERADOR",
      },
    });
    await prisma.responsavelAdministrativo.create({
      data: { usuarioId: responsavel.id, area: "COMPRAS" },
    });
    responsavelComprasEmail = responsavel.email;
  }

  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "MATERIA_PRIMA", categoria: "Papel", nome: `Papel ${s}`, unidade: "UNIDADE" },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: {
      graficaId: grafica.id,
      itemCatalogoId: catalogo.id,
      ativo: true,
      estoqueAtual: 2,
      estoqueMinimo: 10, // já crítico (2 <= 10) — dispara na primeira verificação
    },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return {
    graficaId: grafica.id,
    itemGraficaId: itemGrafica.id,
    donoEmail: dono.email,
    responsavelComprasEmail,
  };
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  dispararEventoEmailMock.mockClear();
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

describe("verificarEDispararAlertaEstoque — roteamento por ResponsavelAdministrativo (área COMPRAS, achado A9)", () => {
  it(
    "gráfica sem responsável de COMPRAS configurado mantém o comportamento de hoje (todo DONO)",
    async () => {
      const f = await criarFixture({});

      const totalCriticos = await verificarEDispararAlertaEstoque(f.graficaId, "Gráfica Teste");
      expect(totalCriticos).toBe(1);

      expect(dispararEventoEmailMock).toHaveBeenCalledTimes(1);
      const destinatarios = dispararEventoEmailMock.mock.calls.map((c) => c[0].destinatario);
      expect(destinatarios).toEqual([f.donoEmail]);
    },
    TIMEOUT_MS
  );

  it(
    "gráfica com responsável de COMPRAS configurado manda só pra ele, sem o DONO",
    async () => {
      const f = await criarFixture({ responsavelCompras: true });

      const totalCriticos = await verificarEDispararAlertaEstoque(f.graficaId, "Gráfica Teste");
      expect(totalCriticos).toBe(1);

      expect(dispararEventoEmailMock).toHaveBeenCalledTimes(1);
      const destinatarios = dispararEventoEmailMock.mock.calls.map((c) => c[0].destinatario);
      expect(destinatarios).toEqual([f.responsavelComprasEmail]);
      expect(destinatarios).not.toContain(f.donoEmail);
    },
    TIMEOUT_MS
  );
});
