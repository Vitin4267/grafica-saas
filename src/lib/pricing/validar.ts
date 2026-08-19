import { ErroPrecificacao } from "./erros";
import type {
  ContextoFlexografia,
  ContextoM2,
  ContextoOffset,
  PedidoFlexografia,
  PedidoM2,
  PedidoOffset,
} from "./tipos";

function validarComum(quantidade: number, larguraM: number, alturaM: number) {
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    throw new ErroPrecificacao(
      "QUANTIDADE_INVALIDA",
      "A quantidade precisa ser um número inteiro maior que zero.",
      { quantidade }
    );
  }
  if (larguraM <= 0 || alturaM <= 0) {
    throw new ErroPrecificacao(
      "DIMENSAO_INVALIDA",
      "Largura e altura precisam ser maiores que zero.",
      { larguraM, alturaM }
    );
  }
}

export function validarPedidoM2(pedido: PedidoM2, contexto: ContextoM2) {
  validarComum(pedido.quantidade, pedido.larguraM, pedido.alturaM);

  if (contexto.bobinas.length === 0) {
    throw new ErroPrecificacao(
      "MATERIAL_SEM_BOBINA",
      "Este material não tem nenhuma bobina cadastrada."
    );
  }
  if (contexto.custoM2Material <= 0) {
    throw new ErroPrecificacao(
      "CUSTO_INVALIDO",
      "O preço de compra do material precisa ser maior que zero.",
      { custoM2Material: contexto.custoM2Material }
    );
  }
}

export function validarPedidoOffset(pedido: PedidoOffset, contexto: ContextoOffset) {
  validarComum(pedido.quantidade, pedido.larguraM, pedido.alturaM);

  if (!Number.isInteger(pedido.corFrente) || pedido.corFrente < 1) {
    throw new ErroPrecificacao(
      "DIMENSAO_INVALIDA",
      "O número de cores de frente precisa ser um inteiro maior ou igual a 1.",
      { corFrente: pedido.corFrente }
    );
  }
  if (!Number.isInteger(pedido.corVerso) || pedido.corVerso < 0) {
    throw new ErroPrecificacao(
      "DIMENSAO_INVALIDA",
      "O número de cores de verso precisa ser um inteiro maior ou igual a 0.",
      { corVerso: pedido.corVerso }
    );
  }
  if (contexto.folhas.length === 0) {
    throw new ErroPrecificacao(
      "MATERIAL_SEM_FOLHA",
      "Este papel não tem nenhum formato de folha cadastrado."
    );
  }
  if (contexto.precoPorKg <= 0) {
    throw new ErroPrecificacao(
      "CUSTO_INVALIDO",
      "O preço por kg do papel precisa ser maior que zero.",
      { precoPorKg: contexto.precoPorKg }
    );
  }
  if (contexto.gramaturaGm2 < 30 || contexto.gramaturaGm2 > 500) {
    throw new ErroPrecificacao(
      "GRAMATURA_INVALIDA",
      "A gramatura do papel precisa estar entre 30 e 500 g/m².",
      { gramaturaGm2: contexto.gramaturaGm2 }
    );
  }
}

export function validarPedidoFlexografia(pedido: PedidoFlexografia, contexto: ContextoFlexografia) {
  validarComum(pedido.quantidade, pedido.larguraM, pedido.alturaM);

  if (!Number.isInteger(pedido.numeroCores) || pedido.numeroCores < 1) {
    throw new ErroPrecificacao(
      "DIMENSAO_INVALIDA",
      "O número de cores precisa ser um inteiro maior ou igual a 1.",
      { numeroCores: pedido.numeroCores }
    );
  }
  if (contexto.bobinas.length === 0) {
    throw new ErroPrecificacao(
      "MATERIAL_SEM_BOBINA",
      "Este material não tem nenhuma bobina cadastrada."
    );
  }
  if (contexto.custoM2Material <= 0) {
    throw new ErroPrecificacao(
      "CUSTO_INVALIDO",
      "O preço de compra do material precisa ser maior que zero.",
      { custoM2Material: contexto.custoM2Material }
    );
  }
}

export function validarSomaEncargos(somaEncargos: number) {
  if (somaEncargos >= 0.85) {
    throw new ErroPrecificacao(
      "ENCARGOS_INVALIDOS",
      "A soma de margem + imposto + comissão + taxa financeira precisa ser menor que 85%, senão o preço explode.",
      { somaEncargos }
    );
  }
}
