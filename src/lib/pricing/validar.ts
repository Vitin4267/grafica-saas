import { ErroPrecificacao } from "./erros";
import type {
  ContextoBordado,
  ContextoDigital,
  ContextoFlexografia,
  ContextoM2,
  ContextoOffset,
  ContextoRevenda,
  PedidoDigital,
  PedidoFlexografia,
  PedidoM2,
  PedidoBordado,
  PedidoOffset,
  PedidoRevenda,
  PedidoSetupPorPeca,
  PedidoTempoMaquina,
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
  // Achado N13 — faixa configurável por gráfica (ParametrosGrafica.
  // gramaturaMinGm2/gramaturaMaxGm2), não mais uma constante fixa. Defaults
  // 30/500 quando o contexto não informa (fixture de teste antiga, ou
  // gráfica sem ParametrosGrafica ainda) preservam o comportamento de
  // sempre. Ver comentário de ContextoOffset em tipos.ts.
  const gramaturaMinGm2 = contexto.gramaturaMinGm2 ?? 30;
  const gramaturaMaxGm2 = contexto.gramaturaMaxGm2 ?? 500;
  if (contexto.gramaturaGm2 < gramaturaMinGm2 || contexto.gramaturaGm2 > gramaturaMaxGm2) {
    throw new ErroPrecificacao(
      "GRAMATURA_INVALIDA",
      `A gramatura do papel precisa estar entre ${gramaturaMinGm2} e ${gramaturaMaxGm2} g/m². Ajuste em Configurações se sua gráfica trabalha fora dessa faixa (ex: cartonagem, editorial).`,
      { gramaturaGm2: contexto.gramaturaGm2, gramaturaMinGm2, gramaturaMaxGm2 }
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

// Achado N4 da auditoria de código (2026-09-04) — Digital agora faz
// imposição igual ao Offset: reaproveita validarComum (exige quantidade E
// largura/altura > 0, antes só quantidade) e passa a exigir pelo menos um
// FormatoFolha cadastrado no papel escolhido, mesma exigência de
// validarPedidoOffset acima pra contexto.folhas.
export function validarPedidoDigital(pedido: PedidoDigital, contexto: ContextoDigital) {
  validarComum(pedido.quantidade, pedido.larguraM, pedido.alturaM);

  if (
    pedido.numeroCliques !== undefined &&
    (!Number.isInteger(pedido.numeroCliques) || pedido.numeroCliques < 1)
  ) {
    throw new ErroPrecificacao(
      "NUMERO_CLIQUES_INVALIDO",
      "O número de cliques por folha precisa ser um inteiro maior ou igual a 1.",
      { numeroCliques: pedido.numeroCliques }
    );
  }
  if (contexto.folhas.length === 0) {
    throw new ErroPrecificacao(
      "MATERIAL_SEM_FOLHA",
      "Este papel não tem nenhum formato de folha cadastrado."
    );
  }
  // materialFornecidoPeloCliente=true (achado B7) zera custoPorFolha DE
  // PROPÓSITO — só barra o zero quando não há essa justificativa (o caso de
  // sempre: gráfica esqueceu de cadastrar precoCompra no papel escolhido).
  if (contexto.custoPorFolha <= 0 && !contexto.materialFornecidoPeloCliente) {
    throw new ErroPrecificacao(
      "CUSTO_INVALIDO",
      "O preço de compra do papel (substrato) precisa ser maior que zero.",
      { custoPorFolha: contexto.custoPorFolha }
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

// Bordado (achado A4) — mesma ausência de dimensões do Digital/setup-por-
// peça acima. numeroPontos é o driver de custo POR PEDIDO (diferente de
// numeroSetups, que é fixo na máquina) — obrigatório e maior que zero, sem
// default possível (não tem "1 ponto padrão" que faça sentido).
// materialFornecidoPeloCliente=true (achado B7) zera custoSubstratoPorPeca
// DE PROPÓSITO, mesma regra de validarPedidoDigital.
export function validarPedidoBordado(pedido: PedidoBordado, contexto: ContextoBordado) {
  validarQuantidade(pedido.quantidade);

  if (!Number.isInteger(pedido.numeroPontos) || pedido.numeroPontos < 1) {
    throw new ErroPrecificacao(
      "NUMERO_PONTOS_INVALIDO",
      "O número de pontos da arte precisa ser um inteiro maior ou igual a 1.",
      { numeroPontos: pedido.numeroPontos }
    );
  }
  if (contexto.custoSubstratoPorPeca <= 0 && !contexto.materialFornecidoPeloCliente) {
    throw new ErroPrecificacao(
      "CUSTO_INVALIDO",
      "O preço de compra do substrato precisa ser maior que zero.",
      { custoSubstratoPorPeca: contexto.custoSubstratoPorPeca }
    );
  }
}

// Tempo de máquina (achado A6) — sem dimensões, sem substrato (não
// representa material, só tempo de máquina). A gráfica escolhe a base na
// máquina: ao menos um de tempoEstimadoMin/metrosCorte precisa estar
// preenchido, senão o item custaria só custoSetupPorJob/custoMinimo em
// silêncio — mesmo espírito das guardas de "sem isso o custo sai zero" do
// resto do motor. Quando metrosCorte é informado sem a máquina cobrar por
// metro (custoPorMetroCorte=0), o motor não lança erro — é um custo zero
// legítimo (a gráfica só cobra por tempo nessa máquina), coerente com o
// resto do arquivo.
export function validarPedidoTempoMaquina(pedido: PedidoTempoMaquina) {
  validarQuantidade(pedido.quantidade);

  if (pedido.tempoEstimadoMin === undefined && pedido.metrosCorte === undefined) {
    throw new ErroPrecificacao(
      "TEMPO_OU_METRO_CORTE_OBRIGATORIO",
      "Informe o tempo estimado de máquina (minutos) ou os metros de corte deste item."
    );
  }
  if (
    pedido.tempoEstimadoMin !== undefined &&
    (!Number.isFinite(pedido.tempoEstimadoMin) || pedido.tempoEstimadoMin <= 0)
  ) {
    throw new ErroPrecificacao(
      "DIMENSAO_INVALIDA",
      "O tempo estimado de máquina precisa ser maior que zero.",
      { tempoEstimadoMin: pedido.tempoEstimadoMin }
    );
  }
  if (pedido.metrosCorte !== undefined && (!Number.isFinite(pedido.metrosCorte) || pedido.metrosCorte <= 0)) {
    throw new ErroPrecificacao(
      "DIMENSAO_INVALIDA",
      "Os metros de corte precisam ser maiores que zero.",
      { metrosCorte: pedido.metrosCorte }
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
