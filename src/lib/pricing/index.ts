export * from "./tipos";
export * from "./erros";
export { calcularM2, type ResultadoM2 } from "./m2";
export { calcularImposicao, calcularOffset, type ResultadoOffset } from "./offset";
export { calcularFlexografia, type ResultadoFlexografia } from "./flexografia";
export { calcularDigital, type ResultadoDigital } from "./digital";
export { calcularSetupPorPeca, type ResultadoSetupPorPeca } from "./setup-por-peca";
export { calcularRevenda, type ResultadoRevenda } from "./revenda";
export { calcularBordado, type ResultadoBordado } from "./bordado";
export { calcularTempoMaquina, type ResultadoTempoMaquina } from "./tempo-maquina";
export {
  calcularQtdBase,
  calcularCustoAcabamento,
  calcularAcabamentos,
  type ItemAcabamentoCalculado,
} from "./acabamento";
export { comporPreco, type ResultadoComposicao } from "./compor";
export { resolverPrecoPapel, type ResultadoPrecoPapel, type OrigemPrecoPapel } from "./papel";
export { precificar, type PedidoPrecificacao, type ContextoPrecificacao, type ResultadoPrecificacao } from "./precificar";
export { paraDecimal, arredondarParaIncremento, tetoInteiro, type Dec } from "./decimal";
