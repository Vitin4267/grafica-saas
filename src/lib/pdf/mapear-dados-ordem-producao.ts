import type { Prisma } from "@/generated/prisma/client";
import { slugify } from "@/lib/slug";
import { rotuloUnidade } from "@/lib/unidade";
import { linhasEtiqueta, ROTULO_LADO, rotuloTipoHotStamping } from "@/app/orcamento/[id]/EtiquetaResumo";
import { converterDeCm, ROTULO_UNIDADE_DIMENSAO, type UnidadeDimensao } from "@/lib/unidade-dimensao";
import type { DadosPdfOrdemProducao, MateriaPrimaPdfOrdem } from "./OrdemProducaoDocumento";

// Formata a quantidade necessária de matéria-prima com no máximo 3 casas
// decimais (a ficha técnica é Decimal(12,6), mas o chão de fábrica não
// precisa de precisão de micrograma) e a unidade cadastrada no catálogo —
// mesmo par materiaPrima/variante que a baixa de estoque real usa (ver
// avancarStatusPedido em src/app/producao/status-transicao.ts).
function formatarQuantidade(quantidade: number, unidade: string | null, unidadeOutro: string | null): string {
  const numero = quantidade.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
  const rotulo = rotuloUnidade(unidade, unidadeOutro);
  return rotulo ? `${numero} ${rotulo}` : numero;
}

type FichaTecnicaParaPdf = {
  quantidadePorUnidade: Prisma.Decimal;
  materiaPrima: {
    itemCatalogo: { nome: string; unidade: string | null; unidadeOutro: string | null };
  };
  variante: { rotulo: string } | null;
};

// Mesmo formato de include usado pra baixa de estoque real (ver
// buscarOrcamentoParaBaixa em src/app/producao/status-transicao.ts) — a
// ordem de produção precisa mostrar EXATAMENTE o que vai ser consumido,
// nunca uma previsão diferente.
export type PedidoParaOrdemProducao = {
  id: string;
  status: string;
  createdAt: Date;
  prazoEntrega: Date | null;
  orcamento: {
    observacoes: string | null;
    cliente: { nome: string };
    grafica: { nome: string };
    itens: {
      quantidade: number;
      larguraCm: Prisma.Decimal | null;
      alturaCm: Prisma.Decimal | null;
      unidadeDimensao: UnidadeDimensao;
      cores: string | null;
      acabamento: string | null;
      acabamentos: {
        qtdBase: Prisma.Decimal;
        itemGrafica: {
          itemCatalogo: { nome: string };
          fichaTecnica: FichaTecnicaParaPdf[];
        };
      }[];
      itemGrafica: {
        itemCatalogo: { nome: string };
        fichaTecnica: FichaTecnicaParaPdf[];
      };
      etiqueta: {
        materialSubstrato: string | null;
        materialSubstratoOutro: string | null;
        tipoAdesivo: string | null;
        tipoAdesivoOutro: string | null;
        superficieAplicacao: string | null;
        superficieAplicacaoOutro: string | null;
        formatoEtiqueta: string | null;
        coresRotulo: number | null;
        coresContraRotulo: number | null;
        embalagemQtdPorRolo: number | null;
        tubeteMedida: string | null;
        rotulagem: string | null;
        serrilha: string | null;
        serrilhaOutro: string | null;
        vernizRotuloTotal: boolean;
        vernizRotuloReserva: boolean;
        vernizRotuloTipo: string | null;
        vernizRotuloTipoOutro: string | null;
        vernizContraRotuloTotal: boolean;
        vernizContraRotuloReserva: boolean;
        vernizContraRotuloTipo: string | null;
        vernizContraRotuloTipoOutro: string | null;
        laminacaoRotulo: string | null;
        laminacaoRotuloOutro: string | null;
        laminacaoContraRotulo: string | null;
        laminacaoContraRotuloOutro: string | null;
        rebobinamento: number | null;
        hotStampings: {
          lado: string;
          tipo: string;
          tipoOutro: string | null;
          medida: string | null;
          cor: string | null;
        }[];
      } | null;
    }[];
  };
};

function mapearFichaTecnica(
  fichas: FichaTecnicaParaPdf[],
  multiplicador: number,
  origemAcabamento: string | null
): MateriaPrimaPdfOrdem[] {
  return fichas.map((ficha) => ({
    materiaPrimaNome: ficha.materiaPrima.itemCatalogo.nome,
    varianteRotulo: ficha.variante?.rotulo ?? null,
    quantidadeNecessaria: formatarQuantidade(
      Number(ficha.quantidadePorUnidade) * multiplicador,
      ficha.materiaPrima.itemCatalogo.unidade,
      ficha.materiaPrima.itemCatalogo.unidadeOutro
    ),
    origemAcabamento,
  }));
}

export function mapearDadosOrdemProducao(pedido: PedidoParaOrdemProducao): DadosPdfOrdemProducao {
  return {
    graficaNome: pedido.orcamento.grafica.nome,
    pedidoNumero: pedido.id.slice(0, 8),
    status: pedido.status,
    clienteNome: pedido.orcamento.cliente.nome,
    criadoEm: pedido.createdAt,
    prazoEntrega: pedido.prazoEntrega,
    observacoes: pedido.orcamento.observacoes,
    itens: pedido.orcamento.itens.map((item) => ({
      nome: item.itemGrafica.itemCatalogo.nome,
      quantidade: item.quantidade,
      medidas:
        item.larguraCm && item.alturaCm
          ? `${converterDeCm(Number(item.larguraCm), item.unidadeDimensao)} × ${converterDeCm(Number(item.alturaCm), item.unidadeDimensao)} ${ROTULO_UNIDADE_DIMENSAO[item.unidadeDimensao]}`
          : null,
      cores: item.cores,
      acabamento: item.acabamento,
      acabamentosEstruturados: item.acabamentos.map((a) => a.itemGrafica.itemCatalogo.nome),
      etiquetaLinhas: item.etiqueta ? linhasEtiqueta(item.etiqueta) : [],
      hotStampingLinhas: (item.etiqueta?.hotStampings ?? []).map((h) => {
        const partes = [rotuloTipoHotStamping(h), h.medida, h.cor].filter(Boolean);
        return `Hot/cold stamping (${ROTULO_LADO[h.lado] ?? h.lado}): ${partes.join(" · ")}`;
      }),
      // Ficha técnica do produto em si (multiplicador = quantidade do item)
      // + a de cada acabamento anexado (multiplicador = qtdBase do
      // acabamento, snapshot da base de cobrança — mesma regra da baixa
      // real, ver comentário de PedidoParaOrdemProducao acima).
      materiaPrima: [
        ...mapearFichaTecnica(item.itemGrafica.fichaTecnica, item.quantidade, null),
        ...item.acabamentos.flatMap((acabamento) =>
          mapearFichaTecnica(
            acabamento.itemGrafica.fichaTecnica,
            Number(acabamento.qtdBase),
            acabamento.itemGrafica.itemCatalogo.nome
          )
        ),
      ],
    })),
  };
}

export function nomeArquivoOrdemProducao(clienteNome: string, idCurto: string): string {
  return `ordem-producao-${slugify(clienteNome)}-${idCurto.slice(0, 8)}.pdf`;
}
