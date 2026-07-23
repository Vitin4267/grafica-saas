import type { Prisma } from "@/generated/prisma/client";
import { formatoMoeda } from "@/lib/moeda";
import { slugify } from "@/lib/slug";
import type { DadosPdfOrcamento } from "./OrcamentoDocumento";

// Formato compartilhado pelas duas rotas de PDF (autenticada e pública) — os
// `include` do Prisma nas duas telas irmãs (orcamento/[id]/page.tsx e
// o/[token]/page.tsx) já produzem essa mesma forma de dado.
export type OrcamentoParaPdf = {
  status: "RASCUNHO" | "ENVIADO" | "APROVADO" | "REJEITADO";
  createdAt: Date;
  total: Prisma.Decimal;
  cliente: { nome: string };
  grafica: { nome: string; logoUrl: string | null };
  itens: {
    quantidade: number;
    larguraCm: Prisma.Decimal | null;
    alturaCm: Prisma.Decimal | null;
    cores: string | null;
    acabamento: string | null;
    precoUnitario: Prisma.Decimal;
    precoTotal: Prisma.Decimal;
    itemGrafica: { itemCatalogo: { nome: string } };
  }[];
};

export function mapearDadosPdf(orcamento: OrcamentoParaPdf): DadosPdfOrcamento {
  return {
    graficaNome: orcamento.grafica.nome,
    logoUrl: orcamento.grafica.logoUrl,
    clienteNome: orcamento.cliente.nome,
    status: orcamento.status,
    criadoEm: orcamento.createdAt,
    total: formatoMoeda.format(Number(orcamento.total)),
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
    })),
  };
}

export function nomeArquivoPdf(clienteNome: string, idCurto: string): string {
  return `orcamento-${slugify(clienteNome)}-${idCurto.slice(0, 8)}.pdf`;
}
