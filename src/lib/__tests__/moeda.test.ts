import { describe, it, expect } from "vitest";
import { formatoMoeda } from "@/lib/moeda";

// Primeiro teste de verdade pra aprender o padrão. A ideia é sempre a mesma:
// 1. Chama a função de verdade com uma entrada conhecida
// 2. Confere (`expect`) se o resultado é EXATAMENTE o que você esperava
// 3. Se um dia o código mudar e quebrar isso, o teste fica vermelho e avisa

// Achado rodando este teste pela primeira vez: o espaço entre "R$" e o
// número NÃO é um espaço normal — é um "espaço sem quebra" (U+00A0), que o
// Intl usa de propósito pra "R$" e "10,00" nunca ficarem em linhas
// diferentes na tela. Visualmente idêntico a um espaço comum, mas é outro
// caractere — por isso as strings abaixo usam ` ` em vez de digitar
// espaço direto no teclado.
describe("formatoMoeda", () => {
  it("formata um número inteiro como reais", () => {
    const resultado = formatoMoeda.format(10);

    expect(resultado).toBe("R$ 10,00");
  });

  it("formata um número com centavos", () => {
    const resultado = formatoMoeda.format(19.9);

    expect(resultado).toBe("R$ 19,90");
  });

  // EXERCÍCIO PRA VOCÊ: descomenta o teste abaixo e preenche o `expect`.
  // Passo a passo:
  //   1. Roda `npm test -- moeda` no terminal e vê o erro (vai reclamar que
  //      "esperado" não é um valor de verdade)
  //   2. No terminal, ou num console.log temporário, roda
  //      `formatoMoeda.format(1234.5)` pra descobrir o resultado real
  //   3. Troca "???" pelo resultado que você achou, salva, roda de novo
  //   4. Teste devia ficar verde
  //
  // it("formata um número com milhar", () => {
  //   const resultado = formatoMoeda.format(1234.5);
  //   expect(resultado).toBe("???");
  // });
});
