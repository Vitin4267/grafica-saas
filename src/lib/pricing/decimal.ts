import Decimal from "decimal.js";

// Instância isolada: não mexe no Decimal global nem depende da cópia interna
// que o Prisma embute no client gerado. Precisão alta o bastante pra cadeias
// longas de multiplicação/divisão sem perder centavos no meio do caminho.
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export type Dec = InstanceType<typeof D>;

export function paraDecimal(valor: number | string | Dec): Dec {
  return new D(valor instanceof D ? valor.toString() : valor);
}

// Quantidades físicas (folhas, faixas, chapas) nunca têm meia unidade.
export function tetoInteiro(valor: Dec): number {
  return valor.ceil().toNumber();
}

// Preço final: arredonda pra cima no incremento comercial configurado (ex: R$0,10).
// Nunca arredondar custos/preços intermediários — só o último passo antes de exibir.
export function arredondarParaIncremento(valor: Dec, incremento: Dec): Dec {
  if (incremento.lte(0)) return valor;
  return valor.div(incremento).ceil().times(incremento);
}

export function maiorDec(a: Dec, b: Dec): Dec {
  return a.gte(b) ? a : b;
}

export function menorDec(a: Dec, b: Dec): Dec {
  return a.lte(b) ? a : b;
}
