import { paraDecimal } from "./decimal";
import { calcularM2 } from "./m2";
import { calcularOffset } from "./offset";
import { calcularFlexografia } from "./flexografia";
import { calcularDigital } from "./digital";
import { calcularSetupPorPeca } from "./setup-por-peca";
import { calcularRevenda } from "./revenda";
import { calcularBordado } from "./bordado";
import { calcularTempoMaquina } from "./tempo-maquina";
import { calcularAcabamentos } from "./acabamento";
import { comporPreco, type ResultadoComposicao } from "./compor";
import { ErroPrecificacao } from "./erros";
import type {
  ConfigAcabamento,
  ContextoAcabamento,
  ContextoBordado,
  ContextoDigital,
  ContextoFlexografia,
  ContextoM2,
  ContextoOffset,
  ContextoRevenda,
  ContextoSetupPorPeca,
  ContextoTempoMaquina,
  ModeloCalculo,
  ParametrosImpressoraDigital,
  ParametrosMaquinaBordado,
  ParametrosMaquinaFlexo,
  ParametrosMaquinaSetupPorPeca,
  ParametrosMaquinaTempo,
  ParametrosPrensa,
  ParametrosTenant,
  PedidoBordado,
  PedidoDigital,
  PedidoFlexografia,
  PedidoM2,
  PedidoOffset,
  PedidoRevenda,
  PedidoSetupPorPeca,
  PedidoTempoMaquina,
} from "./tipos";

export type PedidoPrecificacao =
  | { tipo: "M2"; pedido: PedidoM2; acabamentos: ConfigAcabamento[] }
  | { tipo: "OFFSET"; pedido: PedidoOffset; acabamentos: ConfigAcabamento[] }
  | { tipo: "FLEXOGRAFIA"; pedido: PedidoFlexografia; acabamentos: ConfigAcabamento[] }
  | { tipo: "DIGITAL"; pedido: PedidoDigital; acabamentos: ConfigAcabamento[] }
  // 4 membros distintos (não 1 com tipo de união) de propósito: um discriminante
  // literal único por membro é o que garante narrowing correto do TypeScript —
  // combinar os 4 num `tipo: "SERIGRAFIA" | "SUBLIMACAO" | "ESTAMPAGEM_QUENTE" |
  // "PERSONALIZACAO"` só falha em excluir o membro depois de um
  // `if (pedido.tipo === "SERIGRAFIA" || ...)`. Nenhuma duplicação de LÓGICA —
  // os 4 usam o mesmo PedidoSetupPorPeca e a mesma calcularSetupPorPeca, só a
  // declaração de tipo é repetida. PERSONALIZACAO é o rótulo genérico (achado
  // A3 da auditoria de abrangência) pra tampografia/gravação a laser/DTG/
  // transfer/OUTRO — mesma forma de custo, sem processo nomeado próprio.
  | { tipo: "SERIGRAFIA"; pedido: PedidoSetupPorPeca; acabamentos: ConfigAcabamento[] }
  | { tipo: "SUBLIMACAO"; pedido: PedidoSetupPorPeca; acabamentos: ConfigAcabamento[] }
  | { tipo: "ESTAMPAGEM_QUENTE"; pedido: PedidoSetupPorPeca; acabamentos: ConfigAcabamento[] }
  | { tipo: "PERSONALIZACAO"; pedido: PedidoSetupPorPeca; acabamentos: ConfigAcabamento[] }
  // Revenda/terceirização (achado A12) — produto comprado pronto de um
  // fornecedor ou terceirizado, sem máquina e sem nesting, mesma ausência de
  // dimensões do DIGITAL acima.
  | { tipo: "REVENDA"; pedido: PedidoRevenda; acabamentos: ConfigAcabamento[] }
  // Bordado (achado A4) e tempo de máquina (achado A6) — sem nesting, mesma
  // família do DIGITAL/setup-por-peça/REVENDA acima.
  | { tipo: "BORDADO"; pedido: PedidoBordado; acabamentos: ConfigAcabamento[] }
  | { tipo: "TEMPO_MAQUINA"; pedido: PedidoTempoMaquina; acabamentos: ConfigAcabamento[] };

export type ContextoPrecificacao = {
  itemGraficaId: string;
  modeloCalculo: ModeloCalculo;
  viraFolha: boolean;
  m2?: ContextoM2;
  offset?: ContextoOffset;
  flexografia?: ContextoFlexografia;
  digital?: ContextoDigital;
  setupPorPeca?: ContextoSetupPorPeca;
  revenda?: ContextoRevenda;
  bordado?: ContextoBordado;
  tempoMaquina?: ContextoTempoMaquina;
  parametros: ParametrosTenant;
  parametrosPrensa?: ParametrosPrensa;
  prensaUsada?: { id: string; nome: string };
  parametrosMaquinaFlexo?: ParametrosMaquinaFlexo;
  maquinaFlexoUsada?: { id: string; nome: string };
  parametrosImpressoraDigital?: ParametrosImpressoraDigital;
  impressoraDigitalUsada?: { id: string; nome: string };
  parametrosMaquinaSetupPorPeca?: ParametrosMaquinaSetupPorPeca;
  maquinaSetupPorPecaUsada?: { id: string; nome: string };
  parametrosMaquinaBordado?: ParametrosMaquinaBordado;
  maquinaBordadoUsada?: { id: string; nome: string };
  parametrosMaquinaTempo?: ParametrosMaquinaTempo;
  maquinaTempoUsada?: { id: string; nome: string };
  margemLucroOverride?: number;
  custoEmbalagem?: number;
  custoFreteEstimado?: number;
  // Estimativa de horas do item de orçamento (OrcamentoItem.horasEstimadas)
  // — só consumida por acabamento com baseCobranca=HORA (ver
  // ContextoAcabamento.horasEstimadas em acabamento.ts). Nível topo (não por
  // cenário) porque é um dado do ITEM de orçamento, não do motor de cálculo
  // em si — os 6 branches abaixo só repassam pro ctxAcabamento que já
  // montam.
  horasEstimadas?: number;
  // Motor de clichê de etiqueta (só M2) — presente só quando o produto tem
  // ConfiguracaoClicheEtiqueta E o orçamento informou papel+cores. Custo por
  // clichê = área da etiqueta × custoClichePorCm2; total = isso × nº de
  // cores. Nunca escala com a tiragem/quantidade (achado analisando pedidos
  // reais: mesma etiqueta, mesmo nº de cores, custo de clichê idêntico
  // independente de imprimir 1.000 ou 60.000 unidades).
  etiquetaCliche?: { quantidadeCores: number; custoClichePorCm2: number };
  // Mesma lógica do clichê de etiqueta acima, mas pro motor Flexografia —
  // custoClichePorCm2 × área da peça × nº de cores do pedido, também sem
  // escalar com a quantidade.
  clicheFlexo?: { custoClichePorCm2: number };
  custoFaca?: number; // ferramental de corte, R$ livre, por item de orçamento
};

export type ResultadoPrecificacao = ResultadoComposicao & {
  metricas: Record<string, unknown>;
};

// Campos de ContextoAcabamento que não vêm do cenário de cálculo em si, e sim
// da geometria do item + de um dado avulso do orçamento — os mesmos em todos
// os 6 branches abaixo, centralizados aqui pra não repetir a fórmula 6x.
// perimetroOuEmenda = 2×(largura + altura efetiva), a mesma peça retangular
// que o resto do motor já usa — cobre BaseCobranca.METRO_LINEAR (ilhós,
// bainha, instalação por metro). Nos modelos sem nesting (DIGITAL e os 3 de
// setup-por-peça), largura/altura efetiva já caem em 0 quando não
// informadas — o perímetro também cai em 0, e é papel do chamador (guard em
// orcamento-precificacao.ts) impedir que um acabamento METRO_LINEAR/HORA
// chegue aqui sem os dados que precisa, em vez de custar R$0 em silêncio.
function ctxAcabamentoExtra(
  contexto: ContextoPrecificacao,
  larguraEfetivaM: number,
  alturaEfetivaM: number
): Pick<ContextoAcabamento, "perimetroOuEmenda" | "horasEstimadas"> {
  return {
    perimetroOuEmenda: 2 * (larguraEfetivaM + alturaEfetivaM),
    horasEstimadas: contexto.horasEstimadas,
  };
}

// Orquestrador puro (spec §4.2): roteia por modeloCalculo, calcula o custo-base do
// cenário, soma os acabamentos e delega a composição final (overhead/margem/piso).
export function precificar(
  pedido: PedidoPrecificacao,
  contexto: ContextoPrecificacao
): ResultadoPrecificacao {
  if (pedido.tipo === "M2") {
    if (!contexto.m2) {
      throw new ErroPrecificacao(
        "MATERIAL_SEM_BOBINA",
        "Contexto M2 não fornecido para um item com modeloCalculo=M2."
      );
    }

    const resultado = calcularM2(pedido.pedido, contexto.m2, {
      margemSegurancaPadrao: contexto.parametros.margemSegurancaPadrao,
      gapPecasPadrao: contexto.parametros.gapPecasPadrao,
    });

    const ctxAcabamento: ContextoAcabamento = {
      quantidade: pedido.pedido.quantidade,
      larguraEfetivaM: resultado.larguraEfetivaM.toNumber(),
      alturaEfetivaM: resultado.alturaEfetivaM.toNumber(),
      ...ctxAcabamentoExtra(contexto, resultado.larguraEfetivaM.toNumber(), resultado.alturaEfetivaM.toNumber()),
    };
    const acabamentos = calcularAcabamentos(pedido.acabamentos, ctxAcabamento);

    // Área da PEÇA (não a área faturável com margem/gap de nesting) — o
    // clichê cobre o desenho real da etiqueta, não a folga de segurança
    // usada só pra calcular aproveitamento de bobina.
    const areaClicheCm2 = paraDecimal(pedido.pedido.larguraM)
      .times(pedido.pedido.alturaM)
      .times(10_000);
    const custoCliche = contexto.etiquetaCliche
      ? paraDecimal(contexto.etiquetaCliche.quantidadeCores)
          .times(contexto.etiquetaCliche.custoClichePorCm2)
          .times(areaClicheCm2)
      : undefined;
    const custoFaca = contexto.custoFaca !== undefined ? paraDecimal(contexto.custoFaca) : undefined;

    const composicao = comporPreco({
      quantidade: pedido.pedido.quantidade,
      custoBase: resultado.custoBase,
      custoAcabamentos: acabamentos.total,
      acabamentosDetalhe: acabamentos.itens,
      custoEmbalagem: contexto.custoEmbalagem ? paraDecimal(contexto.custoEmbalagem) : undefined,
      custoFreteEstimado: contexto.custoFreteEstimado
        ? paraDecimal(contexto.custoFreteEstimado)
        : undefined,
      custoCliche,
      custoFaca,
      parametros: contexto.parametros,
      margemLucroOverride: contexto.margemLucroOverride,
    });

    return {
      ...composicao,
      metricas: {
        eficiencia: resultado.eficiencia.toNumber(),
        areaFaturavel: resultado.areaFaturavel.toNumber(),
        areaCobrada: resultado.areaCobrada.toNumber(),
        bobinaEscolhida: resultado.bobinaEscolhida,
        pecasPorFaixa: resultado.pecasPorFaixa,
        numFaixas: resultado.numFaixas,
        custoMaterial: resultado.custoMaterial.toNumber(),
        custoImpressao: resultado.custoImpressao.toNumber(),
        // Achado A9 — presentes só quando a peça excedeu toda bobina
        // cadastrada e o item tem ConfiguracaoEmenda (ver calcularM2/m2.ts).
        // avisos segue o mesmo array que outros achados desta auditoria
        // usam pra devolver alerta sem bloquear o cálculo.
        numPaineis: resultado.numPaineis ?? null,
        custoEmenda: resultado.custoEmenda.toNumber(),
        avisos: resultado.avisos,
      },
    };
  }

  if (pedido.tipo === "OFFSET") {
    if (!contexto.offset) {
      throw new ErroPrecificacao(
        "MATERIAL_SEM_FOLHA",
        "Contexto OFFSET não fornecido para um item com modeloCalculo=OFFSET."
      );
    }
    if (!contexto.parametrosPrensa) {
      throw new ErroPrecificacao(
        "PRENSA_NAO_CONFIGURADA",
        "Parâmetros de prensa não fornecidos para um item com modeloCalculo=OFFSET."
      );
    }

    const resultado = calcularOffset(
      pedido.pedido,
      { ...contexto.offset, viraFolha: contexto.viraFolha },
      contexto.parametrosPrensa
    );

    const ctxAcabamento: ContextoAcabamento = {
      quantidade: pedido.pedido.quantidade,
      larguraEfetivaM: resultado.larguraEfetivaM.toNumber(),
      alturaEfetivaM: resultado.alturaEfetivaM.toNumber(),
      folhasBoas: resultado.folhasBoas,
      folhasPerda: resultado.folhasPerda,
      ...ctxAcabamentoExtra(contexto, resultado.larguraEfetivaM.toNumber(), resultado.alturaEfetivaM.toNumber()),
    };
    const acabamentos = calcularAcabamentos(pedido.acabamentos, ctxAcabamento);

    const composicao = comporPreco({
      quantidade: pedido.pedido.quantidade,
      custoBase: resultado.custoBase,
      custoAcabamentos: acabamentos.total,
      acabamentosDetalhe: acabamentos.itens,
      custoEmbalagem: contexto.custoEmbalagem ? paraDecimal(contexto.custoEmbalagem) : undefined,
      custoFreteEstimado: contexto.custoFreteEstimado
        ? paraDecimal(contexto.custoFreteEstimado)
        : undefined,
      parametros: contexto.parametros,
      margemLucroOverride: contexto.margemLucroOverride,
      detalhesExtras: {
        chapas: resultado.custoChapas,
        rodagem: resultado.custoRodagem,
        setup: resultado.custoSetup,
      },
    });

    return {
      ...composicao,
      metricas: {
        nUp: resultado.nUp,
        rotacionado: resultado.rotacionado,
        entradas: resultado.entradas,
        folhasTotais: resultado.folhasTotais,
        folhaEscolhida: resultado.folhaEscolhida,
        pesoTotalPedidoKg: resultado.pesoTotalPedidoKg.toNumber(),
        prensaUsada: contexto.prensaUsada ?? null,
      },
    };
  }

  if (pedido.tipo === "DIGITAL") {
    if (!contexto.digital) {
      throw new ErroPrecificacao(
        "IMPRESSORA_DIGITAL_NAO_CONFIGURADA",
        "Contexto Digital não fornecido para um item com modeloCalculo=DIGITAL."
      );
    }
    if (!contexto.parametrosImpressoraDigital) {
      throw new ErroPrecificacao(
        "IMPRESSORA_DIGITAL_NAO_CONFIGURADA",
        "Parâmetros de impressora digital não fornecidos para um item com modeloCalculo=DIGITAL."
      );
    }

    const resultado = calcularDigital(
      pedido.pedido,
      contexto.digital,
      contexto.parametrosImpressoraDigital
    );

    // Sem nesting — largura/altura são opcionais (default 0) e só existem
    // aqui pra alimentar um eventual acabamento M2-based (ver comentário em
    // PedidoDigital). orcamento-precificacao.ts já bloqueou antes de chegar
    // aqui se esse acabamento existir sem dimensões informadas.
    const ctxAcabamento: ContextoAcabamento = {
      quantidade: pedido.pedido.quantidade,
      larguraEfetivaM: pedido.pedido.larguraM ?? 0,
      alturaEfetivaM: pedido.pedido.alturaM ?? 0,
      ...ctxAcabamentoExtra(contexto, pedido.pedido.larguraM ?? 0, pedido.pedido.alturaM ?? 0),
    };
    const acabamentos = calcularAcabamentos(pedido.acabamentos, ctxAcabamento);

    const composicao = comporPreco({
      quantidade: pedido.pedido.quantidade,
      custoBase: resultado.custoBase,
      custoAcabamentos: acabamentos.total,
      acabamentosDetalhe: acabamentos.itens,
      custoEmbalagem: contexto.custoEmbalagem !== undefined ? paraDecimal(contexto.custoEmbalagem) : undefined,
      custoFreteEstimado:
        contexto.custoFreteEstimado !== undefined ? paraDecimal(contexto.custoFreteEstimado) : undefined,
      custoFaca: contexto.custoFaca !== undefined ? paraDecimal(contexto.custoFaca) : undefined,
      parametros: contexto.parametros,
      margemLucroOverride: contexto.margemLucroOverride,
      detalhesExtras: { setup: resultado.custoCliques },
    });

    return {
      ...composicao,
      metricas: {
        numeroCliques: resultado.numeroCliques,
        custoCliques: resultado.custoCliques.toNumber(),
        custoSubstrato: resultado.custoSubstrato.toNumber(),
        impressoraDigitalUsada: contexto.impressoraDigitalUsada ?? null,
      },
    };
  }

  if (pedido.tipo === "REVENDA") {
    if (!contexto.revenda) {
      throw new ErroPrecificacao(
        "CUSTO_AQUISICAO_NAO_CONFIGURADO",
        "Contexto de custo de aquisição não fornecido para um item com modeloCalculo=REVENDA."
      );
    }

    const resultado = calcularRevenda(pedido.pedido, contexto.revenda);

    // Sem nesting — mesma razão do Digital acima: dimensões opcionais só pra
    // alimentar um eventual acabamento M2-based. orcamento-precificacao.ts já
    // bloqueou antes de chegar aqui se esse acabamento existir sem elas.
    const ctxAcabamento: ContextoAcabamento = {
      quantidade: pedido.pedido.quantidade,
      larguraEfetivaM: pedido.pedido.larguraM ?? 0,
      alturaEfetivaM: pedido.pedido.alturaM ?? 0,
      ...ctxAcabamentoExtra(contexto, pedido.pedido.larguraM ?? 0, pedido.pedido.alturaM ?? 0),
    };
    const acabamentos = calcularAcabamentos(pedido.acabamentos, ctxAcabamento);

    const composicao = comporPreco({
      quantidade: pedido.pedido.quantidade,
      custoBase: resultado.custoBase,
      custoAcabamentos: acabamentos.total,
      acabamentosDetalhe: acabamentos.itens,
      custoEmbalagem: contexto.custoEmbalagem !== undefined ? paraDecimal(contexto.custoEmbalagem) : undefined,
      custoFreteEstimado:
        contexto.custoFreteEstimado !== undefined ? paraDecimal(contexto.custoFreteEstimado) : undefined,
      custoFaca: contexto.custoFaca !== undefined ? paraDecimal(contexto.custoFaca) : undefined,
      parametros: contexto.parametros,
      margemLucroOverride: contexto.margemLucroOverride,
    });

    return {
      ...composicao,
      metricas: {
        custoAquisicaoUnitario: contexto.revenda.custoAquisicaoUnitario,
        custoAquisicaoTotal: resultado.custoBase.toNumber(),
      },
    };
  }

  if (pedido.tipo === "BORDADO") {
    if (!contexto.bordado) {
      throw new ErroPrecificacao(
        "MAQUINA_BORDADO_NAO_CONFIGURADA",
        "Contexto de substrato não fornecido para um item com modeloCalculo=BORDADO."
      );
    }
    if (!contexto.parametrosMaquinaBordado) {
      throw new ErroPrecificacao(
        "MAQUINA_BORDADO_NAO_CONFIGURADA",
        "Parâmetros de máquina não fornecidos para um item com modeloCalculo=BORDADO."
      );
    }

    const resultado = calcularBordado(pedido.pedido, contexto.bordado, contexto.parametrosMaquinaBordado);

    // Sem nesting — mesma lógica do Digital/setup-por-peça acima.
    const ctxAcabamento: ContextoAcabamento = {
      quantidade: pedido.pedido.quantidade,
      larguraEfetivaM: pedido.pedido.larguraM ?? 0,
      alturaEfetivaM: pedido.pedido.alturaM ?? 0,
      ...ctxAcabamentoExtra(contexto, pedido.pedido.larguraM ?? 0, pedido.pedido.alturaM ?? 0),
    };
    const acabamentos = calcularAcabamentos(pedido.acabamentos, ctxAcabamento);

    const composicao = comporPreco({
      quantidade: pedido.pedido.quantidade,
      custoBase: resultado.custoBase,
      custoAcabamentos: acabamentos.total,
      acabamentosDetalhe: acabamentos.itens,
      custoEmbalagem: contexto.custoEmbalagem !== undefined ? paraDecimal(contexto.custoEmbalagem) : undefined,
      custoFreteEstimado:
        contexto.custoFreteEstimado !== undefined ? paraDecimal(contexto.custoFreteEstimado) : undefined,
      custoFaca: contexto.custoFaca !== undefined ? paraDecimal(contexto.custoFaca) : undefined,
      parametros: contexto.parametros,
      margemLucroOverride: contexto.margemLucroOverride,
      detalhesExtras: { setup: resultado.custoMatriz },
    });

    return {
      ...composicao,
      metricas: {
        custoMatriz: resultado.custoMatriz.toNumber(),
        custoPontos: resultado.custoPontos.toNumber(),
        custoSubstrato: resultado.custoSubstrato.toNumber(),
        maquinaBordadoUsada: contexto.maquinaBordadoUsada ?? null,
      },
    };
  }

  if (pedido.tipo === "TEMPO_MAQUINA") {
    if (!contexto.parametrosMaquinaTempo) {
      throw new ErroPrecificacao(
        "MAQUINA_TEMPO_NAO_CONFIGURADA",
        "Parâmetros de máquina não fornecidos para um item com modeloCalculo=TEMPO_MAQUINA."
      );
    }

    const resultado = calcularTempoMaquina(pedido.pedido, contexto.parametrosMaquinaTempo);

    // Sem nesting, sem substrato — mesma lógica do Digital/setup-por-peça acima.
    const ctxAcabamento: ContextoAcabamento = {
      quantidade: pedido.pedido.quantidade,
      larguraEfetivaM: pedido.pedido.larguraM ?? 0,
      alturaEfetivaM: pedido.pedido.alturaM ?? 0,
      ...ctxAcabamentoExtra(contexto, pedido.pedido.larguraM ?? 0, pedido.pedido.alturaM ?? 0),
    };
    const acabamentos = calcularAcabamentos(pedido.acabamentos, ctxAcabamento);

    const composicao = comporPreco({
      quantidade: pedido.pedido.quantidade,
      custoBase: resultado.custoBase,
      custoAcabamentos: acabamentos.total,
      acabamentosDetalhe: acabamentos.itens,
      custoEmbalagem: contexto.custoEmbalagem !== undefined ? paraDecimal(contexto.custoEmbalagem) : undefined,
      custoFreteEstimado:
        contexto.custoFreteEstimado !== undefined ? paraDecimal(contexto.custoFreteEstimado) : undefined,
      custoFaca: contexto.custoFaca !== undefined ? paraDecimal(contexto.custoFaca) : undefined,
      parametros: contexto.parametros,
      margemLucroOverride: contexto.margemLucroOverride,
      detalhesExtras: { setup: resultado.custoSetup },
    });

    return {
      ...composicao,
      metricas: {
        custoTempo: resultado.custoTempo.toNumber(),
        custoCorte: resultado.custoCorte.toNumber(),
        custoSetup: resultado.custoSetup.toNumber(),
        maquinaTempoUsada: contexto.maquinaTempoUsada ?? null,
      },
    };
  }

  if (
    pedido.tipo === "SERIGRAFIA" ||
    pedido.tipo === "SUBLIMACAO" ||
    pedido.tipo === "ESTAMPAGEM_QUENTE" ||
    pedido.tipo === "PERSONALIZACAO"
  ) {
    if (!contexto.setupPorPeca) {
      throw new ErroPrecificacao(
        "MAQUINA_SETUP_POR_PECA_NAO_CONFIGURADA",
        `Contexto de substrato não fornecido para um item com modeloCalculo=${pedido.tipo}.`
      );
    }
    if (!contexto.parametrosMaquinaSetupPorPeca) {
      throw new ErroPrecificacao(
        "MAQUINA_SETUP_POR_PECA_NAO_CONFIGURADA",
        `Parâmetros de máquina não fornecidos para um item com modeloCalculo=${pedido.tipo}.`
      );
    }

    const resultado = calcularSetupPorPeca(
      pedido.pedido,
      contexto.setupPorPeca,
      contexto.parametrosMaquinaSetupPorPeca
    );

    // Mesma lógica do Digital acima — sem nesting, dimensões opcionais só
    // pra alimentar um eventual acabamento M2-based.
    const ctxAcabamento: ContextoAcabamento = {
      quantidade: pedido.pedido.quantidade,
      larguraEfetivaM: pedido.pedido.larguraM ?? 0,
      alturaEfetivaM: pedido.pedido.alturaM ?? 0,
      ...ctxAcabamentoExtra(contexto, pedido.pedido.larguraM ?? 0, pedido.pedido.alturaM ?? 0),
    };
    const acabamentos = calcularAcabamentos(pedido.acabamentos, ctxAcabamento);

    const composicao = comporPreco({
      quantidade: pedido.pedido.quantidade,
      custoBase: resultado.custoBase,
      custoAcabamentos: acabamentos.total,
      acabamentosDetalhe: acabamentos.itens,
      custoEmbalagem: contexto.custoEmbalagem !== undefined ? paraDecimal(contexto.custoEmbalagem) : undefined,
      custoFreteEstimado:
        contexto.custoFreteEstimado !== undefined ? paraDecimal(contexto.custoFreteEstimado) : undefined,
      custoFaca: contexto.custoFaca !== undefined ? paraDecimal(contexto.custoFaca) : undefined,
      parametros: contexto.parametros,
      margemLucroOverride: contexto.margemLucroOverride,
      detalhesExtras: { setup: resultado.custoSetup },
    });

    return {
      ...composicao,
      metricas: {
        custoSetup: resultado.custoSetup.toNumber(),
        custoVariavel: resultado.custoVariavel.toNumber(),
        custoSubstrato: resultado.custoSubstrato.toNumber(),
        maquinaSetupPorPecaUsada: contexto.maquinaSetupPorPecaUsada ?? null,
      },
    };
  }

  // FLEXOGRAFIA
  if (!contexto.flexografia) {
    throw new ErroPrecificacao(
      "MATERIAL_SEM_BOBINA",
      "Contexto Flexografia não fornecido para um item com modeloCalculo=FLEXOGRAFIA."
    );
  }
  if (!contexto.parametrosMaquinaFlexo) {
    throw new ErroPrecificacao(
      "MAQUINA_FLEXO_NAO_CONFIGURADA",
      "Parâmetros de máquina flexo não fornecidos para um item com modeloCalculo=FLEXOGRAFIA."
    );
  }

  const resultado = calcularFlexografia(
    pedido.pedido,
    contexto.flexografia,
    contexto.parametrosMaquinaFlexo,
    {
      margemSegurancaPadrao: contexto.parametros.margemSegurancaPadrao,
      gapPecasPadrao: contexto.parametros.gapPecasPadrao,
    }
  );

  const ctxAcabamento: ContextoAcabamento = {
    quantidade: pedido.pedido.quantidade,
    larguraEfetivaM: resultado.larguraEfetivaM.toNumber(),
    alturaEfetivaM: resultado.alturaEfetivaM.toNumber(),
    ...ctxAcabamentoExtra(contexto, resultado.larguraEfetivaM.toNumber(), resultado.alturaEfetivaM.toNumber()),
  };
  const acabamentos = calcularAcabamentos(pedido.acabamentos, ctxAcabamento);

  // Mesma fórmula do clichê de etiqueta (M2): área da PEÇA (não a área com
  // margem de segurança) × custoClichePorCm2 × nº de cores do pedido — fixo,
  // não escala com a quantidade.
  const areaClicheCm2 = paraDecimal(pedido.pedido.larguraM)
    .times(pedido.pedido.alturaM)
    .times(10_000);
  const custoCliche = contexto.clicheFlexo
    ? paraDecimal(pedido.pedido.numeroCores)
        .times(contexto.clicheFlexo.custoClichePorCm2)
        .times(areaClicheCm2)
    : undefined;

  const composicao = comporPreco({
    quantidade: pedido.pedido.quantidade,
    custoBase: resultado.custoBase,
    custoAcabamentos: acabamentos.total,
    acabamentosDetalhe: acabamentos.itens,
    custoEmbalagem:
      contexto.custoEmbalagem !== undefined ? paraDecimal(contexto.custoEmbalagem) : undefined,
    custoFreteEstimado:
      contexto.custoFreteEstimado !== undefined
        ? paraDecimal(contexto.custoFreteEstimado)
        : undefined,
    custoCliche,
    custoFaca: contexto.custoFaca !== undefined ? paraDecimal(contexto.custoFaca) : undefined,
    parametros: contexto.parametros,
    margemLucroOverride: contexto.margemLucroOverride,
    detalhesExtras: { rodagem: resultado.custoRodagem, setup: resultado.custoSetup },
  });

  return {
    ...composicao,
    metricas: {
      nUp: resultado.nUp,
      entradas: resultado.entradas,
      numRevolucoes: resultado.numRevolucoes,
      metragemLinearM: resultado.metragemLinearM.toNumber(),
      bobinaEscolhida: resultado.bobinaEscolhida,
      maquinaFlexoUsada: contexto.maquinaFlexoUsada ?? null,
    },
  };
}
