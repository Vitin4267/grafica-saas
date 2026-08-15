import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { dataInputParaUTC, hojeBrasiliaInputValue } from "@/lib/data";

// after() (next/server) lança "called outside a request scope" fora de uma
// requisição Next.js de verdade (ver node_modules/next/dist/server/after/
// after.js) — mesmo motivo de status-transicao.custo-automatico.test.ts
// mockar next/cache. Roda o callback na hora (síncrono) pra poder asserir
// as chamadas de dispararEventoEmail sem precisar de sleep/poll no teste.
vi.mock("next/server", () => ({ after: (tarefa: () => void) => tarefa() }));

// dispararEventoEmail de verdade tentaria bater em EMAIL_WEBHOOK_URL (ausente
// no ambiente de teste) e reportar falha pro Sentry — substituído por um spy
// que só registra a chamada, mesmo padrão de não depender de rede externa
// num teste de integração que já toca o Postgres de verdade.
vi.mock("@/lib/email/webhook-email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email/webhook-email")>();
  return { ...real, dispararEventoEmail: vi.fn(async () => true) };
});

import { dispararEventoEmail } from "@/lib/email/webhook-email";
import { enviarAlertasPrazoEmail } from "./alerta-prazo-email";

const dispararEventoEmailMock = vi.mocked(dispararEventoEmail);

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// mesmo padrão de src/app/producao/status-transicao.custo-automatico.test.ts
// e src/lib/catalogo-ncm.test.ts) — cobre a cascata dos 3 limiares (5, 3, 0
// dias) do alerta de prazo por e-mail: ver comentário grande no topo de
// ./alerta-prazo-email.ts pra a lógica completa. Timeout 30s por teste
// (round-trips sequenciais pro Postgres de dev na Neon).
const TIMEOUT_MS = 30_000;
const sufixo = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const MS_POR_DIA = 86_400_000;

// Mesmo "hoje" que a lib usa (calendário de Brasília, meia-noite UTC) — os
// testes calculam prazoEntrega relativo a este valor, não a `new Date()`
// puro, pra nunca cair no bug de fuso que a própria feature existe pra evitar.
const hoje = dataInputParaUTC(hojeBrasiliaInputValue());
function prazoEmDias(dias: number): Date {
  return new Date(hoje.getTime() + dias * MS_POR_DIA);
}

type Fixture = {
  graficaId: string;
  pedidoId: string;
  vendedorEmail: string;
  donoEmail: string;
};

async function criarFixture(opts: {
  diasAtePrazo: number;
  alertaPrazoUltimoLimiarDias?: number | null;
  vendedorEhDono?: boolean;
  // Sobrescreve ParametrosGrafica.alertaPrazo* pra esta gráfica de teste —
  // omitido = sem linha em ParametrosGrafica, cai nos defaults do schema
  // (ativo=true, limiares 5/3/0), mesmo comportamento hardcoded de antes.
  parametrosPrazo?: { ativo?: boolean; limiar1?: number; limiar2?: number; limiar3?: number };
}): Promise<Fixture> {
  const s = sufixo();
  const grafica = await prisma.grafica.create({
    data: { nome: `Teste Alerta Prazo ${s}`, slug: `teste-alerta-prazo-${s}` },
  });

  if (opts.parametrosPrazo) {
    await prisma.parametrosGrafica.create({
      data: {
        graficaId: grafica.id,
        alertaPrazoAtivo: opts.parametrosPrazo.ativo ?? true,
        alertaPrazoLimiar1Dias: opts.parametrosPrazo.limiar1 ?? 5,
        alertaPrazoLimiar2Dias: opts.parametrosPrazo.limiar2 ?? 3,
        alertaPrazoLimiar3Dias: opts.parametrosPrazo.limiar3 ?? 0,
      },
    });
  }

  const dono = await prisma.usuario.create({
    data: {
      graficaId: grafica.id,
      nome: `Dono ${s}`,
      email: `dono-${s}@example.com`,
      senhaHash: "x",
      papel: "DONO",
    },
  });
  const vendedor = opts.vendedorEhDono
    ? dono
    : await prisma.usuario.create({
        data: {
          graficaId: grafica.id,
          nome: `Vendedor ${s}`,
          email: `vendedor-${s}@example.com`,
          senhaHash: "x",
          papel: "OPERADOR",
        },
      });

  const cliente = await prisma.cliente.create({ data: { graficaId: grafica.id, nome: `Cliente ${s}` } });

  const catalogo = await prisma.itemCatalogo.create({
    data: { graficaId: grafica.id, tipo: "PRODUTO", categoria: "Cartão", nome: `Produto ${s}` },
  });
  const itemGrafica = await prisma.itemGrafica.create({
    data: { graficaId: grafica.id, itemCatalogoId: catalogo.id },
  });

  const orcamento = await prisma.orcamento.create({
    data: { graficaId: grafica.id, clienteId: cliente.id, usuarioId: vendedor.id, status: "APROVADO", total: 100 },
  });
  await prisma.orcamentoItem.create({
    data: { orcamentoId: orcamento.id, itemGraficaId: itemGrafica.id, quantidade: 5, precoUnitario: 20, precoTotal: 100 },
  });

  const pedido = await prisma.pedido.create({
    data: {
      graficaId: grafica.id,
      orcamentoId: orcamento.id,
      status: "FILA",
      prazoEntrega: prazoEmDias(opts.diasAtePrazo),
      alertaPrazoUltimoLimiarDias: opts.alertaPrazoUltimoLimiarDias ?? null,
    },
  });

  graficaIdsParaLimpar.push(grafica.id);

  return { graficaId: grafica.id, pedidoId: pedido.id, vendedorEmail: vendedor.email, donoEmail: dono.email };
}

const graficaIdsParaLimpar: string[] = [];

afterEach(async () => {
  dispararEventoEmailMock.mockClear();
  for (const graficaId of graficaIdsParaLimpar) {
    await prisma.pedido.deleteMany({ where: { graficaId } });
    await prisma.orcamentoItem.deleteMany({ where: { orcamento: { graficaId } } });
    await prisma.orcamento.deleteMany({ where: { graficaId } });
    await prisma.itemGrafica.deleteMany({ where: { graficaId } });
    await prisma.itemCatalogo.deleteMany({ where: { graficaId } });
    await prisma.cliente.deleteMany({ where: { graficaId } });
    await prisma.usuario.deleteMany({ where: { graficaId } });
    await prisma.grafica.delete({ where: { id: graficaId } }).catch(() => {});
  }
  graficaIdsParaLimpar.length = 0;
}, TIMEOUT_MS);

const ORIGEM = "https://app.exemplo.com";

describe("enviarAlertasPrazoEmail — cascata dos limiares 5/3/0 dias", () => {
  it(
    "pedido a 6 dias do prazo não dispara nada (limiar aplicável só existe a partir de 5 dias)",
    async () => {
      const f = await criarFixture({ diasAtePrazo: 6 });

      const resultado = await enviarAlertasPrazoEmail(ORIGEM);

      expect(resultado.processados).toBe(0);
      expect(dispararEventoEmailMock).not.toHaveBeenCalled();
      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedido.alertaPrazoUltimoLimiarDias).toBeNull();
    },
    TIMEOUT_MS
  );

  it(
    "a 5 dias dispara o limiar 5 pro vendedor + DONO e grava; rodar de novo no mesmo dia não duplica",
    async () => {
      const f = await criarFixture({ diasAtePrazo: 5 });

      const primeira = await enviarAlertasPrazoEmail(ORIGEM);
      expect(primeira.processados).toBe(1);

      const pedidoAposPrimeira = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedidoAposPrimeira.alertaPrazoUltimoLimiarDias).toBe(5);

      // Um e-mail pro vendedor + um pro DONO (dois destinatários distintos).
      expect(dispararEventoEmailMock).toHaveBeenCalledTimes(2);
      const destinatarios = dispararEventoEmailMock.mock.calls.map((c) => c[0].destinatario).sort();
      expect(destinatarios).toEqual([f.donoEmail, f.vendedorEmail].sort());
      for (const chamada of dispararEventoEmailMock.mock.calls) {
        expect(chamada[0].tipo).toBe("pedido_prazo_proximo");
        expect(chamada[0].texto).toContain("Faltam 5 dias");
      }

      dispararEventoEmailMock.mockClear();
      const segunda = await enviarAlertasPrazoEmail(ORIGEM);
      expect(segunda.processados).toBe(0);
      expect(dispararEventoEmailMock).not.toHaveBeenCalled();
    },
    TIMEOUT_MS
  );

  it(
    "cron perdeu um dia: pedido pula direto pro limiar 3, nunca manda um 'faltam 5 dias' desatualizado",
    async () => {
      // Simula "última vez que rodou tinha 6 dias restantes, hoje tem 2" —
      // nenhum alerta foi enviado ainda (alertaPrazoUltimoLimiarDias null).
      const f = await criarFixture({ diasAtePrazo: 2 });

      const resultado = await enviarAlertasPrazoEmail(ORIGEM);
      expect(resultado.processados).toBe(1);

      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedido.alertaPrazoUltimoLimiarDias).toBe(3);

      expect(dispararEventoEmailMock).toHaveBeenCalledTimes(2);
      for (const chamada of dispararEventoEmailMock.mock.calls) {
        expect(chamada[0].tipo).toBe("pedido_prazo_proximo");
        expect(chamada[0].texto).toContain("Faltam 3 dias");
        expect(chamada[0].texto).not.toContain("Faltam 5 dias");
      }
    },
    TIMEOUT_MS
  );

  it(
    "pedido atrasado (prazo já vencido) dispara o limiar 0, mesmo já tendo avisado o limiar 3 antes",
    async () => {
      const f = await criarFixture({ diasAtePrazo: -1, alertaPrazoUltimoLimiarDias: 3 });

      const resultado = await enviarAlertasPrazoEmail(ORIGEM);
      expect(resultado.processados).toBe(1);

      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedido.alertaPrazoUltimoLimiarDias).toBe(0);

      expect(dispararEventoEmailMock).toHaveBeenCalledTimes(2);
      for (const chamada of dispararEventoEmailMock.mock.calls) {
        expect(chamada[0].tipo).toBe("pedido_prazo_atrasado");
        expect(chamada[0].texto).toContain("venceu há 1 dia");
      }
    },
    TIMEOUT_MS
  );

  it(
    "pedido com alertaPrazoUltimoLimiarDias=0 nunca mais dispara, mesmo com o atraso aumentando",
    async () => {
      const f = await criarFixture({ diasAtePrazo: -10, alertaPrazoUltimoLimiarDias: 0 });

      const resultado = await enviarAlertasPrazoEmail(ORIGEM);

      expect(resultado.processados).toBe(0);
      expect(dispararEventoEmailMock).not.toHaveBeenCalled();
      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedido.alertaPrazoUltimoLimiarDias).toBe(0); // intocado
    },
    TIMEOUT_MS
  );

  it(
    "vendedor que também é DONO recebe um único e-mail, não dois (dedup por e-mail)",
    async () => {
      const f = await criarFixture({ diasAtePrazo: 0, vendedorEhDono: true });

      const resultado = await enviarAlertasPrazoEmail(ORIGEM);
      expect(resultado.processados).toBe(1);

      expect(dispararEventoEmailMock).toHaveBeenCalledTimes(1);
      expect(dispararEventoEmailMock.mock.calls[0][0].destinatario).toBe(f.vendedorEmail);
      expect(dispararEventoEmailMock.mock.calls[0][0].tipo).toBe("pedido_prazo_atrasado");
    },
    TIMEOUT_MS
  );
});

describe("enviarAlertasPrazoEmail — limiares configuráveis por gráfica (ParametrosGrafica)", () => {
  it(
    "gráfica com alertaPrazoAtivo=false não dispara nada, mesmo com pedido já atrasado",
    async () => {
      const f = await criarFixture({ diasAtePrazo: -3, parametrosPrazo: { ativo: false } });

      const resultado = await enviarAlertasPrazoEmail(ORIGEM);

      expect(resultado.processados).toBe(0);
      expect(dispararEventoEmailMock).not.toHaveBeenCalled();
      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedido.alertaPrazoUltimoLimiarDias).toBeNull(); // nunca marcado, pra reavaliar se a gráfica reativar depois
    },
    TIMEOUT_MS
  );

  it(
    "gráfica com limiares customizados (7/4/1) usa esses valores em vez do padrão 5/3/0",
    async () => {
      // A 6 dias do prazo: com os limiares padrão (5/3/0) não dispararia nada
      // (limiarAplicavel null, ver primeiro describe acima); com 7/4/1
      // configurado, 6 cai no limiar1=7.
      const f = await criarFixture({
        diasAtePrazo: 6,
        parametrosPrazo: { limiar1: 7, limiar2: 4, limiar3: 1 },
      });

      const resultado = await enviarAlertasPrazoEmail(ORIGEM);
      expect(resultado.processados).toBe(1);

      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedido.alertaPrazoUltimoLimiarDias).toBe(7);

      expect(dispararEventoEmailMock).toHaveBeenCalledTimes(2);
      for (const chamada of dispararEventoEmailMock.mock.calls) {
        expect(chamada[0].tipo).toBe("pedido_prazo_proximo");
        expect(chamada[0].texto).toContain("Faltam 7 dias");
      }
    },
    TIMEOUT_MS
  );

  it(
    "gráfica com limiar3 customizado (1, não 0) trata esse valor como o terminal — nunca reenvia depois dele",
    async () => {
      const f = await criarFixture({
        diasAtePrazo: 0,
        alertaPrazoUltimoLimiarDias: 1,
        parametrosPrazo: { limiar1: 7, limiar2: 4, limiar3: 1 },
      });

      const resultado = await enviarAlertasPrazoEmail(ORIGEM);

      expect(resultado.processados).toBe(0);
      expect(dispararEventoEmailMock).not.toHaveBeenCalled();
      const pedido = await prisma.pedido.findUniqueOrThrow({ where: { id: f.pedidoId } });
      expect(pedido.alertaPrazoUltimoLimiarDias).toBe(1); // intocado
    },
    TIMEOUT_MS
  );
});
