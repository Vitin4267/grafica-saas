import type { Prisma } from "@/generated/prisma/client";
import { formatoMoeda } from "@/lib/moeda";
import { slugify } from "@/lib/slug";
import { linhasEtiqueta, ROTULO_LADO, rotuloTipoHotStamping } from "@/app/orcamento/[id]/EtiquetaResumo";
import { converterDeCm, ROTULO_UNIDADE_DIMENSAO, type UnidadeDimensao } from "@/lib/unidade-dimensao";
import { calcularConversoesPreco } from "@/lib/unidade-contagem";
import type { DadosPdfOrcamento } from "./OrcamentoDocumento";

const ROTULO_TIPO_PEDIDO: Record<string, string> = {
  MODELO_NOVO: "Modelo novo",
  REPETICAO_SEM_ALTERACAO: "Repetição sem alteração",
  REPETICAO_COM_ALTERACAO: "Repetição com alteração",
};
const ROTULO_FRETE: Record<string, string> = { EMITENTE: "Emitente", DESTINATARIO: "Destinatário" };

// Formato compartilhado pelas duas rotas de PDF (autenticada e pública) — os
// `include` do Prisma nas duas telas irmãs (orcamento/[id]/page.tsx e
// o/[token]/page.tsx) já produzem essa mesma forma de dado.
export type OrcamentoParaPdf = {
  status: "RASCUNHO" | "ENVIADO" | "APROVADO" | "REJEITADO";
  createdAt: Date;
  total: Prisma.Decimal;
  // Nome DECLARADO por quem respondeu pelo link público — não verificado
  // (ver comentário de Orcamento.respostaPublicaNome no schema). Só existe
  // quando status já é APROVADO/REJEITADO; nunca escrever "confirmado por"
  // a partir disto, só "aprovado/recusado por".
  respostaPublicaNome: string | null;
  respostaPublicaEm: Date | null;
  cliente: { nome: string };
  grafica: { nome: string; logoUrl: string | null; corPrimaria: string | null };
  // Bloco 1 (dados gerais) — seguros pro cliente ver, ao contrário de
  // observações (interno) e etapas de produção (interno), que nunca entram
  // aqui de propósito (ver comentário em DadosPdfOrcamento).
  vendedor: string | null;
  tipoPedido: string | null;
  condicoesPagamento: string | null;
  frete: string | null;
  transportadora: string | null;
  localEntrega: string | null;
  itens: {
    quantidade: number;
    larguraCm: Prisma.Decimal | null;
    alturaCm: Prisma.Decimal | null;
    unidadeDimensao: UnidadeDimensao;
    cores: string | null;
    acabamento: string | null;
    acabamentos: { itemGrafica: { itemCatalogo: { nome: string } } }[];
    precoUnitario: Prisma.Decimal;
    precoTotal: Prisma.Decimal;
    itemGrafica: {
      itemCatalogo: { nome: string };
      unidadeContagem: string | null;
      fatorConversao: Prisma.Decimal | null;
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

export function mapearDadosPdf(orcamento: OrcamentoParaPdf): DadosPdfOrcamento {
  const dadosPedido = {
    vendedor: orcamento.vendedor,
    tipoPedido: orcamento.tipoPedido ? (ROTULO_TIPO_PEDIDO[orcamento.tipoPedido] ?? orcamento.tipoPedido) : null,
    condicoesPagamento: orcamento.condicoesPagamento,
    frete: orcamento.frete ? (ROTULO_FRETE[orcamento.frete] ?? orcamento.frete) : null,
    transportadora: orcamento.transportadora,
    localEntrega: orcamento.localEntrega,
  };
  const temDadosPedido = Object.values(dadosPedido).some((v) => v !== null);

  return {
    graficaNome: orcamento.grafica.nome,
    logoUrl: orcamento.grafica.logoUrl,
    corPrimaria: orcamento.grafica.corPrimaria,
    clienteNome: orcamento.cliente.nome,
    status: orcamento.status,
    criadoEm: orcamento.createdAt,
    respostaPublicaNome: orcamento.respostaPublicaNome,
    respostaPublicaEm: orcamento.respostaPublicaEm,
    total: formatoMoeda.format(Number(orcamento.total)),
    dadosPedido: temDadosPedido ? dadosPedido : null,
    itens: orcamento.itens.map((item) => ({
      nome: item.itemGrafica.itemCatalogo.nome,
      quantidade: item.quantidade,
      medidas:
        item.larguraCm && item.alturaCm
          ? `${converterDeCm(Number(item.larguraCm), item.unidadeDimensao)} × ${converterDeCm(Number(item.alturaCm), item.unidadeDimensao)} ${ROTULO_UNIDADE_DIMENSAO[item.unidadeDimensao]}`
          : null,
      cores: item.cores,
      acabamento: item.acabamento,
      acabamentosEstruturados: item.acabamentos.map((a) => a.itemGrafica.itemCatalogo.nome),
      precoUnitario: formatoMoeda.format(Number(item.precoUnitario)),
      precoTotal: formatoMoeda.format(Number(item.precoTotal)),
      conversoesPreco: calcularConversoesPreco({
        precoUnitario: Number(item.precoUnitario),
        unidadeContagem: item.itemGrafica.unidadeContagem,
        fatorConversao: item.itemGrafica.fatorConversao ? Number(item.itemGrafica.fatorConversao) : null,
        embalagemQtdPorRolo: item.etiqueta?.embalagemQtdPorRolo ?? null,
      }).map((c) => `${c.valorFormatado} / ${c.rotulo}`),
      etiquetaLinhas: item.etiqueta ? linhasEtiqueta(item.etiqueta) : [],
      hotStampingLinhas: (item.etiqueta?.hotStampings ?? []).map((h) => {
        const partes = [rotuloTipoHotStamping(h), h.medida, h.cor].filter(Boolean);
        return `Hot/cold stamping (${ROTULO_LADO[h.lado] ?? h.lado}): ${partes.join(" · ")}`;
      }),
    })),
  };
}

export function nomeArquivoPdf(clienteNome: string, idCurto: string): string {
  return `orcamento-${slugify(clienteNome)}-${idCurto.slice(0, 8)}.pdf`;
}
