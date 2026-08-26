import { ErroPrecificacao } from "./erros";
import type {
  ContextoDigital,
  ContextoFlexografia,
  ContextoM2,
  ContextoOffset,
  ContextoRevenda,
  PedidoDigital,
  PedidoFlexografia,
  PedidoM2,
  PedidoOffset,
  PedidoRevenda,
  PedidoSetupPorPeca,
} from "./tipos";

// Extraído pra ser reaproveitado por todo pedido (M2/OFFSET/FLEXOGRAFIA via
// validarComum, e DIGITAL/setup-por-peça diretamente) — evita duplicar o
// mesmo check pela 5ª vez.
export function validarQuantidade(quantidade: number) {
  if (!Number.isInteger(quantidade) || quantidade <= 0) {
    throw new ErroPrecificacao(
      "QUANTIDADE_INVALIDA",
      "A quantidade precisa ser um número inteiro maior que zero.",
      { quantidade }
    );
  }
}

function validarComum(quantidade: number, larguraM: number, alturaM: number) {
  validarQuantidade(quantidade);
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

// Digital não tem dimensões (sem nesting) — só quantidade + nº de cliques.
export function validarPedidoDigital(pedido: PedidoDigital, contexto: ContextoDigital) {
  validarQuantidade(pedido.quantidade);

  if (
    pedido.numeroCliques !== undefined &&
    (!Number.isInteger(pedido.numeroCliques) || pedido.numeroCliques < 1)
  ) {
    throw new ErroPrecificacao(
      "NUMERO_CLIQUES_INVALIDO",
      "O número de cliques precisa ser um inteiro maior ou igual a 1.",
      { numeroCliques: pedido.numeroCliques }
    );
  }
  // materialFornecidoPeloCliente=true (achado B7) zera custoSubstratoPorPeca
  // DE PROPÓSITO — só barra o zero quando não há essa justificativa (o caso
  // de sempre: gráfica esqueceu de cadastrar precoCompra no catálogo).
  if (contexto.custoSubstratoPorPeca <= 0 && !contexto.materialFornecidoPeloCliente) {
    throw new ErroPrecificacao(
      "CUSTO_INVALIDO",
      "O preço de compra do substrato precisa ser maior que zero.",
      { custoSubstratoPorPeca: contexto.custoSubstratoPorPeca }
    );
  }
}

// Serigrafia/Sublimação/Estampagem a quente (setup por peça) — mesma
// ausência de dimensões do Digital; validação compartilhada pelos 3
// ModeloCalculo (ver calcularSetupPorPeca).
export function validarPedidoSetupPorPeca(pedido: PedidoSetupPorPeca) {
  validarQuantidade(pedido.quantidade);

  if (!Number.isInteger(pedido.numeroSetups) || pedido.numeroSetups < 1) {
    throw new ErroPrecificacao(
      "NUMERO_SETUPS_INVALIDO",
      "O número de setups precisa ser um inteiro maior ou igual a 1.",
      { numeroSetups: pedido.numeroSetups }
    );
  }
}

// Revenda/terceirização (achado A12) — sem dimensões, sem setup, mesma
// ausência do Digital acima. custoAquisicaoUnitario <= 0 é tratado como "não
// configurado" (mesmo código de erro do guard em precificar.ts) porque, na
// prática, um custo de aquisição zerado é exatamente esse estado: nem o
// orçamento nem o catálogo (ItemGrafica.precoCompra) tem um valor real.
export function validarPedidoRevenda(pedido: PedidoRevenda, contexto: ContextoRevenda) {
  validarQuantidade(pedido.quantidade);

  if (contexto.custoAquisicaoUnitario <= 0) {
    throw new ErroPrecificacao(
      "CUSTO_AQUISICAO_NAO_CONFIGURADO",
      "O custo de aquisição precisa ser maior que zero — informe o custo neste orçamento ou cadastre o preço de compra no catálogo.",
      { custoAquisicaoUnitario: contexto.custoAquisicaoUnitario }
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
