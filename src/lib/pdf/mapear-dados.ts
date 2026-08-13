import type { Prisma } from "@/generated/prisma/client";
import { formatoMoeda } from "@/lib/moeda";
import { slugify } from "@/lib/slug";
import { linhasEtiqueta, ROTULO_LADO, ROTULO_TIPO_HOT } from "@/app/orcamento/[id]/EtiquetaResumo";
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
  cliente: { nome: string };
  grafica: { nome: string; logoUrl: string | null };
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
    cores: string | null;
    acabamento: string | null;
    precoUnitario: Prisma.Decimal;
    precoTotal: Prisma.Decimal;
    itemGrafica: { itemCatalogo: { nome: string } };
    etiqueta: {
      materialSubstrato: string | null;
      materialSubstratoOutro: string | null;
      tipoAdesivo: string | null;
      superficieAplicacao: string | null;
      formatoEtiqueta: string | null;
      coresRotulo: number | null;
      coresContraRotulo: number | null;
      embalagemQtdPorRolo: number | null;
      tubeteMedida: string | null;
      rotulagem: string | null;
      serrilha: string | null;
      vernizRotuloTotal: boolean;
      vernizRotuloReserva: boolean;
      vernizRotuloTipo: string | null;
      vernizContraRotuloTotal: boolean;
      vernizContraRotuloReserva: boolean;
      vernizContraRotuloTipo: string | null;
      laminacaoRotulo: string | null;
      laminacaoContraRotulo: string | null;
      rebobinamento: number | null;
      hotStampings: { lado: string; tipo: string; medida: string | null; cor: string | null }[];
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
    clienteNome: orcamento.cliente.nome,
    status: orcamento.status,
    criadoEm: orcamento.createdAt,
    total: formatoMoeda.format(Number(orcamento.total)),
    dadosPedido: temDadosPedido ? dadosPedido : null,
    itens: orcamento.itens.map((item) => ({
      nome: item.itemGrafica.itemCatalogo.nome,
      quantidade: item.quantidade,
      medidas:
        item.larguraCm && item.alturaCm
          ? `${Number(item.larguraCm)} × ${Number(item.alturaCm)} cm`
          : null,
      cores: item.cores,
      acabamento: item.acabamento,
      precoUnitario: formatoMoeda.format(Number(item.precoUnitario)),
      precoTotal: formatoMoeda.format(Number(item.precoTotal)),
      etiquetaLinhas: item.etiqueta ? linhasEtiqueta(item.etiqueta) : [],
      hotStampingLinhas: (item.etiqueta?.hotStampings ?? []).map((h) => {
        const partes = [ROTULO_TIPO_HOT[h.tipo] ?? h.tipo, h.medida, h.cor].filter(Boolean);
        return `Hot/cold stamping (${ROTULO_LADO[h.lado] ?? h.lado}): ${partes.join(" · ")}`;
      }),
    })),
  };
}

export function nomeArquivoPdf(clienteNome: string, idCurto: string): string {
  return `orcamento-${slugify(clienteNome)}-${idCurto.slice(0, 8)}.pdf`;
}
