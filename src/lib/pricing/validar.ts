import { ErroPrecificacao } from "./erros";
import type {
  ContextoBordado,
  ContextoChapaRigida,
  ContextoDigital,
  ContextoEditorial,
  ContextoFlexografia,
  ContextoM2,
  ContextoOffset,
  ContextoRevenda,
  ContextoSetupPorPeca,
  ParametrosMaquinaBordado,
  ParametrosMaquinaFlexo,
  ParametrosPrensa,
  PedidoChapaRigida,
  PedidoDigital,
  PedidoEditorial,
  PedidoFlexografia,
  PedidoM2,
  PedidoBordado,
  PedidoOffset,
  PedidoRevenda,
  PedidoSetupPorPeca,
  PedidoTempoMaquina,
} from "./tipos";

// Achado 2 da auditoria do motor M2/Offset (2026-09-12) — "Perda padrão (%)"
// é rotulado como percentual mas consumido cru como FRAÇÃO (folhasPerda =
// ceil(folhasBoas × perdaPercent)). O público-alvo é leigo (ver form em
// PrensaForm.tsx/MaquinaFlexografiaForm.tsx) e o campo Overhead — o único
// outro percentual do motor com esse mesmo risco — tem o hint "ex: 0.15 =
// 15%"; este não tinha nenhum. Sem trava, um dono digitando "3" pensando em
// 3% grava 300% e QUADRUPLICA o papel do pedido inteiro. Mesmo espírito de
// validarSomaEncargos (trava a soma de encargos em 0,85) — aqui a faixa
// válida de uma FRAÇÃO é sempre [0,1], então é fixa (não configurável por
// tenant, diferente de gramaturaMinGm2/gramaturaMaxGm2 acima).
function validarPerdaPercent(perdaPercent: number) {
  if (!Number.isFinite(perdaPercent) || perdaPercent < 0 || perdaPercent > 1) {
    throw new ErroPrecificacao(
      "PERDA_INVALIDA",
      "A perda padrão precisa ser uma fração entre 0 e 1 (ex: 0.03 = 3%) — valor configurado ou informado no pedido está fora dessa faixa.",
      { perdaPercent }
    );
  }
}

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

export function validarPedidoOffset(
  pedido: PedidoOffset,
  contexto: ContextoOffset,
  params: ParametrosPrensa
) {
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
  // Achado 2 — valida o campo RESOLVIDO (pedido sobrepõe cadastro), o mesmo
  // valor que offset.ts realmente usa em `paraDecimal(pedido.perdaPercent ??
  // params.perdaPercentPadrao)` — o dedo-gordo pode vir tanto do cadastro da
  // prensa (Configurações) quanto de um override pontual neste pedido.
  validarPerdaPercent(pedido.perdaPercent ?? params.perdaPercentPadrao);
}

export function validarPedidoFlexografia(
  pedido: PedidoFlexografia,
  contexto: ContextoFlexografia,
  params: ParametrosMaquinaFlexo
) {
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
  // Achado 2 — mesmo campo/mesmo bug do Offset acima (ParametrosMaquinaFlexo.
  // perdaPercentPadrao/PedidoFlexografia.perdaPercent, usados de forma
  // idêntica em calcularFlexografia). Mesmo raciocínio: valida o valor
  // RESOLVIDO (pedido sobrepõe cadastro).
  validarPerdaPercent(pedido.perdaPercent ?? params.perdaPercentPadrao);
}

// Achado N4 da auditoria de código (2026-09-04) — Digital agora faz
// imposição igual ao Offset: reaproveita validarComum (exige quantidade E
// largura/altura > 0, antes só quantidade) e passa a exigir pelo menos um
// FormatoFolha cadastrado no papel escolhido, mesma exigência de
// validarPedidoOffset acima pra contexto.folhas.
export function validarPedidoDigital(pedido: PedidoDigital, contexto: ContextoDigital) {
  validarComum(pedido.quantidade, pedido.larguraM, pedido.alturaM);

  // Achado A4 da auditoria do motor de preço (2026-09-13) — sem teto, um
  // vendedor confundindo "cliques por folha" com "total de folhas do
  // pedido" (a tela já disse "por peça" três vezes até esta correção — ver
  // SeletorItemOrcamento.tsx/EditarOrcamentoForm.tsx) digitava o total de
  // folhas aqui (ex: 48) e o motor multiplicava numeroFolhas × 48 em vez de
  // ×1 — 48× o custo real. Nenhuma impressora digital de verdade passa a
  // mesma folha mais de ~20× (frente/verso + verniz/branco/primer em
  // passagens extras é o teto real do mercado) — acima disso é
  // quase certamente o mesmo erro de digitação.
  const NUMERO_CLIQUES_MAX = 20;
  if (
    pedido.numeroCliques !== undefined &&
    (!Number.isInteger(pedido.numeroCliques) ||
      pedido.numeroCliques < 1 ||
      pedido.numeroCliques > NUMERO_CLIQUES_MAX)
  ) {
    throw new ErroPrecificacao(
      "NUMERO_CLIQUES_INVALIDO",
      `O número de cliques POR FOLHA precisa ser um inteiro entre 1 e ${NUMERO_CLIQUES_MAX}. Se você digitou o total de folhas do pedido por engano, deixe em branco — o motor já multiplica por folha automaticamente.`,
      { numeroCliques: pedido.numeroCliques, max: NUMERO_CLIQUES_MAX }
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
export function validarPedidoSetupPorPeca(pedido: PedidoSetupPorPeca, contexto: ContextoSetupPorPeca) {
  validarQuantidade(pedido.quantidade);

  if (!Number.isInteger(pedido.numeroSetups) || pedido.numeroSetups < 1) {
    throw new ErroPrecificacao(
      "NUMERO_SETUPS_INVALIDO",
      "O número de setups precisa ser um inteiro maior ou igual a 1.",
      { numeroSetups: pedido.numeroSetups }
    );
  }
  // Achado B10 da auditoria do motor de preço (2026-09-13) — mesma trava de
  // ContextoDigital/ContextoBordado (achado B7), replicada aqui: setup-por-
  // peça era o único dos 3 motores com substrato sem essa checagem, então
  // um produto SERIGRAFIA/SUBLIMACAO/ESTAMPAGEM_QUENTE/PERSONALIZACAO
  // cadastrado sem precoCompra custava a peça em branco a R$0 em silêncio.
  if (contexto.custoSubstratoPorPeca <= 0 && !contexto.materialFornecidoPeloCliente) {
    throw new ErroPrecificacao(
      "CUSTO_INVALIDO",
      "O preço de compra do substrato (peça em branco) precisa ser maior que zero.",
      { custoSubstratoPorPeca: contexto.custoSubstratoPorPeca }
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

// Achado B1 da auditoria do motor de preço (2026-09-13) — custoHoraMaq e
// velocidadePontosPorMinuto andam sempre juntos (ver comentário em
// tipos.ts/bordado.ts): sem os dois, não há como converter R$/h num custo
// real. salvarMaquinaBordado já impede isso no cadastro, mas máquinas
// criadas ANTES desta versão podem ter custoHoraMaq preenchido sem
// velocidade — defesa em profundidade pra nunca reproduzir em silêncio o
// bug que esta correção fechou.
export function validarParametrosMaquinaBordado(params: ParametrosMaquinaBordado) {
  if (params.custoHoraMaq !== undefined && params.velocidadePontosPorMinuto === undefined) {
    throw new ErroPrecificacao(
      "MAQUINA_BORDADO_SEM_VELOCIDADE",
      "Esta máquina de bordado tem custo por hora configurado mas não tem a velocidade (pontos/minuto) cadastrada — sem isso o motor não sabe quanto tempo o pedido consome. Preencha a velocidade na máquina, em Configurações > Máquinas > Bordado.",
      { custoHoraMaq: params.custoHoraMaq }
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

// Editorial multipágina (achado A10, Rota 1) — sem nesting, mas COM
// dimensões obrigatórias (formato fechado da página, precisa da área pro
// peso do papel — diferente de Digital/setup-por-peça/Bordado/Tempo de
// máquina acima, onde largura/altura são opcionais). numeroPaginas é a
// contagem do MIOLO, sempre obrigatória e maior que zero (sem "1 página
// padrão" que faça sentido, mesmo raciocínio de numeroPontos do Bordado).
// Papel de miolo e capa não têm fallback de produto (diferente de OFFSET) —
// os dois preços por kg precisam ser > 0.
export function validarPedidoEditorial(pedido: PedidoEditorial, contexto: ContextoEditorial) {
  validarComum(pedido.quantidade, pedido.larguraM, pedido.alturaM);

  if (!Number.isInteger(pedido.numeroPaginas) || pedido.numeroPaginas < 1) {
    throw new ErroPrecificacao(
      "NUMERO_PAGINAS_INVALIDO",
      "O número de páginas do miolo precisa ser um inteiro maior ou igual a 1.",
      { numeroPaginas: pedido.numeroPaginas }
    );
  }
  if (pedido.temOrelhas && (!pedido.larguraOrelhaM || pedido.larguraOrelhaM <= 0)) {
    throw new ErroPrecificacao(
      "DIMENSAO_INVALIDA",
      "Informe a largura da orelha (maior que zero) quando o item tem orelhas.",
      { larguraOrelhaM: pedido.larguraOrelhaM }
    );
  }
  if (contexto.precoPorKgMiolo <= 0) {
    throw new ErroPrecificacao(
      "PAPEL_MIOLO_NAO_CONFIGURADO",
      "O preço por kg do papel do miolo precisa ser maior que zero.",
      { precoPorKgMiolo: contexto.precoPorKgMiolo }
    );
  }
  if (contexto.precoPorKgCapa <= 0) {
    throw new ErroPrecificacao(
      "PAPEL_CAPA_NAO_CONFIGURADO",
      "O preço por kg do papel da capa precisa ser maior que zero.",
      { precoPorKgCapa: contexto.precoPorKgCapa }
    );
  }
  // Achado A5 da auditoria do motor de preço (2026-09-13) — um caderno é
  // sempre uma folha física DOBRADA (múltiplo de 4 páginas: 4, 8, 16, 32...
  // nunca 2, 6, 10). Antes, qualquer inteiro >= 1 passava — um dono lendo
  // "páginas por caderno" como "páginas por FOLHA" e digitando 2 fazia
  // numFolhasMiolo = paginasEfetivas/2 sair fracionário e o motor nunca
  // arredondar pra caderno nenhum (ceil(numeroPaginas/2)×2 = numeroPaginas
  // sempre), subdimensionando papel/impressão do miolo inteiro em silêncio.
  if (
    !Number.isInteger(contexto.paginasPorCaderno) ||
    contexto.paginasPorCaderno < 4 ||
    contexto.paginasPorCaderno % 4 !== 0
  ) {
    throw new ErroPrecificacao(
      "NUMERO_PAGINAS_INVALIDO",
      "O número de páginas por caderno configurado na gráfica precisa ser um múltiplo de 4 (ex: 4, 8, 16, 32) — um caderno é sempre uma folha física dobrada.",
      { paginasPorCaderno: contexto.paginasPorCaderno }
    );
  }
  // Achado C1 da auditoria do motor de preço (2026-09-13) — mesma faixa e
  // mesmo default 30/500 que validarPedidoOffset já usa (achado N13). O
  // gêmeo OFFSET validava isso e EDITORIAL não — um dedo-gordo digitando 9
  // em vez de 90 g/m² não tinha NENHUMA trava: resolverPrecoPapel cai pra
  // linha mais próxima da tabela em silêncio (ver papel.ts), então o motor
  // seguia calculando com um peso de papel ~10× menor sem erro nenhum.
  // Miolo E capa passam pelo mesmo caminho (mesmo buraco nos dois).
  const gramaturaMinGm2 = contexto.gramaturaMinGm2 ?? 30;
  const gramaturaMaxGm2 = contexto.gramaturaMaxGm2 ?? 500;
  if (contexto.gramaturaMioloGm2 < gramaturaMinGm2 || contexto.gramaturaMioloGm2 > gramaturaMaxGm2) {
    throw new ErroPrecificacao(
      "GRAMATURA_INVALIDA",
      `A gramatura do miolo precisa estar entre ${gramaturaMinGm2} e ${gramaturaMaxGm2} g/m². Ajuste em Configurações se sua gráfica trabalha fora dessa faixa.`,
      { gramaturaMioloGm2: contexto.gramaturaMioloGm2, gramaturaMinGm2, gramaturaMaxGm2 }
    );
  }
  if (contexto.gramaturaCapaGm2 < gramaturaMinGm2 || contexto.gramaturaCapaGm2 > gramaturaMaxGm2) {
    throw new ErroPrecificacao(
      "GRAMATURA_INVALIDA",
      `A gramatura da capa precisa estar entre ${gramaturaMinGm2} e ${gramaturaMaxGm2} g/m². Ajuste em Configurações se sua gráfica trabalha fora dessa faixa.`,
      { gramaturaCapaGm2: contexto.gramaturaCapaGm2, gramaturaMinGm2, gramaturaMaxGm2 }
    );
  }
}

// Chapa rigida (achado A7) -- mesma exigencia de dimensao/quantidade do
// Digital (validarComum), mais ao menos um FormatoFolha cadastrado no
// PRODUTO (mesma exigencia de contexto.folhas do Offset/Digital acima) e um
// preco de chapa > 0. Corte (tempoEstimadoMin/metrosCorte) e OPCIONAL --
// diferente de validarPedidoTempoMaquina, NAO exige "ao menos um dos dois":
// ausentes os dois = corte simplesmente nao entra no custo (ver
// calcularChapaRigida). Quando informado, cada campo precisa ser finito e
// maior que zero, mesma checagem individual de validarPedidoTempoMaquina.
export function validarPedidoChapaRigida(pedido: PedidoChapaRigida, contexto: ContextoChapaRigida) {
  validarComum(pedido.quantidade, pedido.larguraM, pedido.alturaM);

  if (contexto.folhas.length === 0) {
    throw new ErroPrecificacao(
      "MATERIAL_SEM_FOLHA",
      "Esta chapa não tem nenhum formato de folha cadastrado."
    );
  }
  // Achado A3 da auditoria do motor de preço (2026-09-13) — defesa em
  // profundidade: salvarConfiguracaoProduto (catalogo/[itemGraficaId]/actions.ts)
  // já impede gravar mais de 1 FormatoFolha num produto CHAPA_RIGIDA, mas o
  // motor puro não deveria confiar só nisso — 2+ formatos aqui significa
  // preço fixo (contexto.precoPorChapa, 1 valor só) sendo aplicado a mais
  // de um tamanho físico, o mesmo estado ambíguo que causava o achado A3.
  if (contexto.folhas.length > 1) {
    throw new ErroPrecificacao(
      "MATERIAL_SEM_FOLHA",
      "Esta chapa tem mais de um formato cadastrado — Chapa rígida aceita só 1 (preço é fixo por chapa inteira). Corrija em Catálogo antes de orçar.",
      { quantidadeFormatos: contexto.folhas.length }
    );
  }
  if (contexto.precoPorChapa <= 0) {
    throw new ErroPrecificacao(
      "CUSTO_INVALIDO",
      "O preço de compra da chapa precisa ser maior que zero.",
      { precoPorChapa: contexto.precoPorChapa }
    );
  }
  if (
    pedido.tempoEstimadoMin !== undefined &&
    (!Number.isFinite(pedido.tempoEstimadoMin) || pedido.tempoEstimadoMin <= 0)
  ) {
    throw new ErroPrecificacao(
      "DIMENSAO_INVALIDA",
      "O tempo estimado de corte precisa ser maior que zero.",
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

// Achado D2 da auditoria do motor de preço (2026-09-13) — exportado (não só
// literal dentro da função) pra src/app/clientes/actions.ts poder rejeitar
// Cliente.margemPadraoOverride >= este teto NO CADASTRO, em vez de deixar o
// erro só aparecer no primeiro orçamento desse cliente (com uma mensagem que
// aponta pra "Configurações", onde não há nada errado — o campo culpado é
// margemPadraoOverride, e a tela de cliente nem é mencionada). Um
// margemPadraoOverride sozinho >= este limiar já garante ENCARGOS_INVALIDOS
// em QUALQUER orçamento desse cliente, não importa o resto dos encargos da
// gráfica (imposto/comissão/taxa financeira só somam, nunca subtraem).
export const LIMITE_SOMA_ENCARGOS = 0.85;

export function validarSomaEncargos(somaEncargos: number) {
  if (somaEncargos >= LIMITE_SOMA_ENCARGOS) {
    throw new ErroPrecificacao(
      "ENCARGOS_INVALIDOS",
      "A soma de margem + imposto + comissão + taxa financeira precisa ser menor que 85%, senão o preço explode.",
      { somaEncargos }
    );
  }
}
