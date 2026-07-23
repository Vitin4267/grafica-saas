import { describe, it, expect, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { reservarTentativaLogin } from "./rate-limit";

// Teste de INTEGRAÇÃO de verdade (toca o Postgres de dev via DATABASE_URL,
// não é lógica pura) — regressão da race condition encontrada na auditoria
// de 2026-07-23: verificarBloqueioLogin (count) e registrarTentativaLogin
// (create) eram duas chamadas Prisma separadas, então N requisições
// paralelas liam "abaixo do limite" ao mesmo tempo e todas passavam. Fica
// fora do padrão de teste puro do resto do projeto de propósito — sem isso
// não dá pra provar que a transação Serializable realmente fecha a corrida
// (nenhum mock de Prisma simula conflito de serialização de verdade).
// Precisa de DATABASE_URL disponível (Vitest carrega .env automaticamente).
const EMAIL_TESTE = "teste-regressao-rate-limit@example.invalid";
const IP_TESTE = "203.0.113.99";
const LIMITE_POR_EMAIL = 5;

async function limpar() {
  await prisma.tentativaLogin.deleteMany({ where: { email: EMAIL_TESTE } });
}

afterEach(limpar, 30_000);

describe("reservarTentativaLogin — regressão de race condition (2026-07-23)", () => {
  it("nunca reserva mais tentativas que o limite, mesmo sob concorrência real", async () => {
    await limpar();

    const N = 15;
    const resultados = await Promise.allSettled(
      Array.from({ length: N }, () => reservarTentativaLogin(EMAIL_TESTE, IP_TESTE))
    );

    const reservados = resultados.filter(
      (r) => r.status === "fulfilled" && r.value !== null
    ).length;
    const linhasNoBanco = await prisma.tentativaLogin.count({ where: { email: EMAIL_TESTE } });

    expect(reservados).toBeLessThanOrEqual(LIMITE_POR_EMAIL);
    expect(linhasNoBanco).toBeLessThanOrEqual(LIMITE_POR_EMAIL);
    expect(linhasNoBanco).toBe(reservados);
  }, 30_000);

  it("bloqueia (retorna null) depois de atingir o limite, sem concorrência", async () => {
    await limpar();

    for (let i = 0; i < LIMITE_POR_EMAIL; i++) {
      const reserva = await reservarTentativaLogin(EMAIL_TESTE, IP_TESTE);
      expect(reserva).not.toBeNull();
    }

    const bloqueado = await reservarTentativaLogin(EMAIL_TESTE, IP_TESTE);
    expect(bloqueado).toBeNull();
  }, 30_000);
});
