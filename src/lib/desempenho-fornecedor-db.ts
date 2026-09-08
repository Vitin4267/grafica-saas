import "server-only";
import { prisma } from "@/lib/prisma";
import {
  calcularDesempenhoFornecedores,
  type CompraParaDesempenho,
  type DesempenhoFornecedor,
} from "@/lib/desempenho-fornecedor";

// Busca as solicitações de compra JÁ FECHADAS (RECEBIDO/CONFERIDO —
// RECEBIDO_PARCIAL fica de fora, ainda em aberto) desta gráfica, com
// fornecedor conhecido, e monta o desempenho por fornecedor (achado A11 da
// auditoria de abrangência, Parte 3/Compras). `fornecedorId` opcional filtra
// pra um só (ex: tela de detalhe de um fornecedor específico) sem trazer o
// histórico inteiro da gráfica.
export async function buscarDesempenhoFornecedores(
  graficaId: string,
  fornecedorId?: string
): Promise<Map<string, DesempenhoFornecedor>> {
  const solicitacoes = await prisma.solicitacaoCompra.findMany({
    where: {
      graficaId,
      fornecedorId: fornecedorId ? fornecedorId : { not: null },
      status: { in: ["RECEBIDO", "CONFERIDO"] },
    },
    select: {
      fornecedorId: true,
      fornecedor: { select: { nome: true } },
      compradoEm: true,
      recebidoEm: true,
      divergenciaObservacao: true,
      // Achado A4 — a cotação vencedora vinculada, quando existe (upsert
      // garante no máximo uma por fornecedor por solicitação, e só uma
      // marcada vencedora=true por solicitação, ver comentário do model
      // CotacaoFornecedor no schema).
      cotacoes: {
        where: { vencedora: true },
        select: { prazoEntregaDias: true },
        take: 1,
      },
    },
  });

  const bruto: CompraParaDesempenho[] = solicitacoes
    // fornecedorId já filtrado no where (nunca null aqui), o `filter`
    // abaixo só satisfaz o TypeScript sem mudar o resultado.
    .filter((s) => s.fornecedorId !== null && s.fornecedor !== null)
    .map((s) => ({
      fornecedorId: s.fornecedorId!,
      fornecedorNome: s.fornecedor!.nome,
      compradoEm: s.compradoEm,
      recebidoEm: s.recebidoEm,
      prazoEntregaDiasPrometido: s.cotacoes[0]?.prazoEntregaDias ?? null,
      divergenciaObservacao: s.divergenciaObservacao,
    }));

  return calcularDesempenhoFornecedores(bruto);
}
