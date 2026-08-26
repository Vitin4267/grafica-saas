import { type Dec, paraDecimal } from "./decimal";
import { validarPedidoRevenda } from "./validar";
import type { ContextoRevenda, PedidoRevenda } from "./tipos";

export type ResultadoRevenda = {
  custoAquisicaoTotal: Dec;
  custoBase: Dec;
};

// Revenda / terceirização (achado A12 da auditoria de abrangência,
// 2026-08-24): produto comprado pronto de um fornecedor (brinde) ou
// terceirizado (peça que a própria gráfica não produz) — sem máquina, sem
// setup, sem nesting. O custo é só Q × custoAquisicaoUnitario. Diferente de
// SIMPLES (preço digitado, custo zero), REVENDA passa pelo mesmo comporPreco
// de todo mundo em precificar.ts — ganha overhead, imposto, margem e piso
// automaticamente, e gera breakdown auditável (o "quanto lucrei" deixa de
// ficar cego pra revenda/terceirização).
export function calcularRevenda(pedido: PedidoRevenda, contexto: ContextoRevenda): ResultadoRevenda {
  validarPedidoRevenda(pedido, contexto);

  const custoAquisicaoTotal = paraDecimal(pedido.quantidade).times(contexto.custoAquisicaoUnitario);

  return {
    custoAquisicaoTotal,
    custoBase: custoAquisicaoTotal,
  };
}
