import { describe, it, expect } from "vitest";
import { validarSomaCronogramaEntrega } from "./orcamento-entrega-programada";

// Teste UNITÁRIO puro (sem banco) da função de validação de soma do achado
// B3/Parte 1 (versão contratual reduzida, 2026-09-09) — critério escolhido:
// soma ABAIXO do total é aceita com aviso ("faltam X"), soma ACIMA é
// rejeitada. Ver comentário completo em validarSomaCronogramaEntrega.
describe("validarSomaCronogramaEntrega", () => {
  it("aceita soma abaixo do total, sinalizando quanto falta", () => {
    const resultado = validarSomaCronogramaEntrega([{ quantidade: 10_000 }, { quantidade: 15_000 }], 60_000);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.soma).toBe(25_000);
    expect(resultado.completo).toBe(false);
    expect(resultado.faltam).toBe(35_000);
  });

  it("aceita soma exatamente igual ao total (cronograma completo)", () => {
    const resultado = validarSomaCronogramaEntrega(
      [{ quantidade: 10_000 }, { quantidade: 10_000 }, { quantidade: 10_000 }],
      30_000
    );
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.completo).toBe(true);
    expect(resultado.faltam).toBe(0);
  });

  it("rejeita soma acima do total", () => {
    const resultado = validarSomaCronogramaEntrega([{ quantidade: 40_000 }, { quantidade: 30_000 }], 60_000);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.mensagem).toMatch(/ultrapassa/);
  });

  it("lista vazia (nenhuma linha ainda) é sempre válida, com o total inteiro faltando", () => {
    const resultado = validarSomaCronogramaEntrega([], 60_000);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.soma).toBe(0);
    expect(resultado.faltam).toBe(60_000);
  });
});
