// Cálculo puro (sem Prisma) — testável isoladamente. A extração do custo
// real por item (breakdown do motor avançado vs. precoCompra do SIMPLES)
// fica no chamador (src/app/orcamento/[id]/actions.ts), que tem acesso ao
// banco; aqui só decide o valor-base e a comissão a partir de números já
// prontos.
export type BaseComissao = "VALOR" | "LUCRO";

// Math.max(0, custoTotal) é defesa em profundidade: um custo NEGATIVO faria
// `precoTotal - custoTotal` SOMAR ao valor-base, inflando a comissão do
// vendedor em vez de reduzi-la. A origem desse custo negativo (precoCompra
// negativo aceito em salvarCatalogo) foi fechada na auditoria de 2026-07-26,
// mas o cálculo não deve depender disso — um custo negativo não tem
// significado físico e nunca deve virar lucro.
export function calcularValorBase(
  total: number,
  itens: { precoTotal: number; custoTotal: number }[],
  baseCalculo: BaseComissao
): number {
  if (baseCalculo === "VALOR") return total;
  return itens.reduce(
    (soma, item) => soma + (item.precoTotal - Math.max(0, item.custoTotal)),
    0
  );
}

// Math.max(0, ...) — um orçamento vendido abaixo do custo (desconto grande,
// erro de precificação) nunca vira comissão negativa descontada de outra
// coisa; nesse caso o vendedor simplesmente não recebe por aquele orçamento.
export function calcularComissao(valorBase: number, percentual: number): number {
  return Math.max(0, valorBase) * percentual;
}
