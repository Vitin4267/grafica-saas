import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { reservarCheckout, liberarReservaCheckout } from "./checkout-reserva";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL) —
// regressão do TOCTOU encontrado na auditoria de 2026-07-23: duas
// requisições simultâneas de iniciarCheckout, partindo de TRIALING (sem
// stripeSubscriptionId ainda), passavam as duas pelo guard antigo e abriam
// duas Checkout Sessions reais no Stripe. Fora do padrão de teste puro do
// resto do projeto de propósito, mesmo motivo de rate-limit.test.ts.
async function criarGraficaTeste() {
  const grafica = await prisma.grafica.create({
    data: { nome: "Teste Regressão Checkout (audit)", slug: `teste-checkout-audit-${Date.now()}-${Math.random()}` },
  });
  await prisma.assinaturaGrafica.create({ data: { graficaId: grafica.id, status: "TRIALING" } });
  return grafica.id;
}

async function limparGrafica(graficaId: string) {
  await prisma.assinaturaGrafica.deleteMany({ where: { graficaId } });
  await prisma.grafica.delete({ where: { id: graficaId } });
}

const graficasCriadas: string[] = [];

afterEach(async () => {
  await Promise.all(graficasCriadas.splice(0).map(limparGrafica));
}, 30_000);

describe("reservarCheckout — regressão de checkout duplicado (2026-07-23)", () => {
  it("só uma de N requisições paralelas consegue reservar, partindo de TRIALING", async () => {
    const graficaId = await criarGraficaTeste();
    graficasCriadas.push(graficaId);

    const N = 15;
    const resultados = await Promise.all(
      Array.from({ length: N }, () => reservarCheckout(graficaId))
    );

    const reservadas = resultados.filter((r) => r.reservado).length;
    expect(reservadas).toBe(1);
  }, 30_000);

  it("bloqueia uma segunda reserva logo em seguida (sem esperar o TTL)", async () => {
    const graficaId = await criarGraficaTeste();
    graficasCriadas.push(graficaId);

    const primeira = await reservarCheckout(graficaId);
    expect(primeira.reservado).toBe(true);

    const segunda = await reservarCheckout(graficaId);
    expect(segunda.reservado).toBe(false);
    if (!segunda.reservado) {
      expect(segunda.motivo).toBe("checkout_em_andamento");
    }
  }, 30_000);

  it("libera a reserva quando o checkout falha, permitindo tentar de novo na hora", async () => {
    const graficaId = await criarGraficaTeste();
    graficasCriadas.push(graficaId);

    const primeira = await reservarCheckout(graficaId);
    expect(primeira.reservado).toBe(true);
    if (!primeira.reservado) throw new Error("esperava reserva bem-sucedida");

    await liberarReservaCheckout(graficaId, primeira.agora);

    const segunda = await reservarCheckout(graficaId);
    expect(segunda.reservado).toBe(true);
  }, 30_000);

  it("bloqueia com motivo 'assinatura_ativa' quando já existe assinatura paga viva", async () => {
    const graficaId = await criarGraficaTeste();
    graficasCriadas.push(graficaId);

    await prisma.assinaturaGrafica.update({
      where: { graficaId },
      data: { status: "ATIVA", stripeSubscriptionId: `sub_teste_${Date.now()}` },
    });

    const reserva = await reservarCheckout(graficaId);
    expect(reserva.reservado).toBe(false);
    if (!reserva.reservado) {
      expect(reserva.motivo).toBe("assinatura_ativa");
    }
  }, 30_000);
});
