import { D, type Dec } from "@/lib/pricing/decimal";

// Valores de dinheiro como chegam de fontes variadas: Prisma.Decimal (lido
// do banco), number (formulário já parseado) ou string (FormData bruta).
// null/undefined = campo não preenchido, entra como 0 na soma (ver
// calcularCustoAquisicaoTotal abaixo).
type ValorMonetario = { toString(): string } | null | undefined;

// Achado A2 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
// "rota curta" de custo de aquisição real: custoUnitario = valorFinal /
// quantidade fica errado quando a nota tem frete/IPI embutido, ou quando
// há ICMS creditável/desconto que reduzem o custo de fato. Função PURA
// (sem I/O) pra ser reusada tanto no servidor (avancarStatusCompra, ver
// src/app/compras/status-transicao.ts) quanto num eventual preview no
// client — nenhum dos dois lados recalcula com fórmula própria.
//
// Todos os 4 componentes são opcionais: ausentes (null/undefined) somam/
// subtraem zero, então custoAquisicaoTotal(valorFinal, null, null, null,
// null) === valorFinal — compra antiga (ou nova sem esses campos
// preenchidos) calcula EXATAMENTE igual a antes desta feature.
//
// valorFrete e valorIpi AUMENTAM o custo de aquisição; valorIcmsCreditavel
// e valorDesconto REDUZEM.
export function calcularCustoAquisicaoTotal(
  valorFinal: ValorMonetario,
  valorFrete: ValorMonetario,
  valorIpi: ValorMonetario,
  valorIcmsCreditavel: ValorMonetario,
  valorDesconto: ValorMonetario
): Dec {
  const paraDec = (v: ValorMonetario): Dec => (v === null || v === undefined ? new D(0) : new D(v.toString()));

  return paraDec(valorFinal)
    .plus(paraDec(valorFrete))
    .plus(paraDec(valorIpi))
    .minus(paraDec(valorIcmsCreditavel))
    .minus(paraDec(valorDesconto));
}
