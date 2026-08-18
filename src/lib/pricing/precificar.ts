import { paraDecimal } from "./decimal";
import { calcularM2 } from "./m2";
import { calcularOffset } from "./offset";
import { calcularAcabamentos } from "./acabamento";
import { comporPreco, type ResultadoComposicao } from "./compor";
import { ErroPrecificacao } from "./erros";
import type {
  ConfigAcabamento,
  ContextoAcabamento,
  ContextoM2,
  ContextoOffset,
  ModeloCalculo,
  ParametrosPrensa,
  ParametrosTenant,
  PedidoM2,
  PedidoOffset,
} from "./tipos";

export type PedidoPrecificacao =
  | { tipo: "M2"; pedido: PedidoM2; acabamentos: ConfigAcabamento[] }
  | { tipo: "OFFSET"; pedido: PedidoOffset; acabamentos: ConfigAcabamento[] };

export type ContextoPrecificacao = {
  itemGraficaId: string;
  modeloCalculo: ModeloCalculo;
  viraFolha: boolean;
  m2?: ContextoM2;
  offset?: ContextoOffset;
  parametros: ParametrosTenant;
  parametrosPrensa?: ParametrosPrensa;
  prensaUsada?: { id: string; nome: string };
  margemLucroOverride?: number;
  custoEmbalagem?: number;
  custoFreteEstimado?: number;
  // Motor de clichê de etiqueta (só M2) — presente só quando o produto tem
  // ConfiguracaoClicheEtiqueta E o orçamento informou papel+cores. Fixo por
  // cor, nunca escala com a quantidade (mesmo padrão de custoChapas do offset).
  etiquetaCliche?: { quantidadeCores: number; custoClicheUnitario: number };
  custoFaca?: number; // ferramental de corte, R$ livre, por item de orçamento
};

export type ResultadoPrecificacao = ResultadoComposicao & {
  metricas: Record<string, unknown>;
};

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
    };
    const acabamentos = calcularAcabamentos(pedido.acabamentos, ctxAcabamento);

    const custoCliche = contexto.etiquetaCliche
      ? paraDecimal(contexto.etiquetaCliche.quantidadeCores).times(
          contexto.etiquetaCliche.custoClicheUnitario
        )
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
      },
    };
  }

  // OFFSET
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
