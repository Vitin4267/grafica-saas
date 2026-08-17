import "server-only";
import { z } from "zod";
import { parseDataBrasileira, parseNumeroBrasileiro } from "./planilha";
import { Prisma } from "@/generated/prisma/client";
// import type: escritores.ts importa a FUNÇÃO deste arquivo — ver comentário
// equivalente em escritor-clientes.ts.
import type { ResultadoEscritaLinha } from "./escritores";

const opcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const pedidoImportacaoSchema = z.object({
  clienteNome: z.string().trim().min(2, "Nome do cliente muito curto"),
  clienteDocumento: opcional(160),
  produtoDescricao: z.string().trim().min(1, "Informe o produto/serviço"),
  quantidade: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return 1;
      const n = parseNumeroBrasileiro(v);
      if (n === null || n <= 0) return 1;
      return Math.round(n);
    }),
  valorTotal: z
    .string({ error: "Informe o valor total do pedido." })
    .min(1, "Informe o valor total do pedido.")
    .transform((v, ctx) => {
      const n = parseNumeroBrasileiro(v);
      if (n === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor total inválido — não consegui interpretar como número." });
        return z.NEVER;
      }
      if (n <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Valor total precisa ser maior que zero." });
        return z.NEVER;
      }
      return n;
    }),
  data: z
    .string({ error: "Informe a data do pedido." })
    .min(1, "Informe a data do pedido.")
    .transform((v, ctx) => {
      const d = parseDataBrasileira(v);
      if (d === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Data do pedido inválida — use o formato DD/MM/AAAA." });
        return z.NEVER;
      }
      return d;
    }),
  vendedor: opcional(120),
  observacoes: opcional(2000),
});

// Escreve um PEDIDO HISTÓRICO já vendido/entregue — diferente do fluxo normal
// (Orcamento nasce RASCUNHO e vira Pedido só quando aprovado), aqui os dois
// já nascem no estado final (APROVADO / ENTREGUE), porque a planilha de
// origem é sempre "o que já foi vendido", nunca um orçamento em aberto. Sem
// precedente de "um registro só" pra Orcamento+Pedido no resto do app — essa
// função existe só pra este importador.
export async function escreverLinhaPedido(
  tx: Prisma.TransactionClient,
  graficaId: string,
  usuarioId: string,
  linha: Record<string, string>
): Promise<ResultadoEscritaLinha> {
  const parsed = pedidoImportacaoSchema.safeParse(linha);
  if (!parsed.success) {
    return { ok: false, mensagem: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const {
    clienteNome,
    clienteDocumento,
    produtoDescricao,
    quantidade,
    valorTotal,
    data: dataHistorica,
    vendedor,
    observacoes,
  } = parsed.data;

  // 1. Cliente: reaproveita por documento (se veio) ou nome exato — só cria
  // um novo cadastro quando nenhum dos dois bate. Sem tratamento de P2002 de
  // propósito (ver plano): uma corrida real em [graficaId,documento] dentro
  // de uma transação de UMA linha é praticamente impossível, e um erro
  // genuíno aqui deve mesmo propagar pro chamador marcar a linha como erro.
  let cliente = await tx.cliente.findFirst({
    where: {
      graficaId,
      OR: [
        ...(clienteDocumento ? [{ documento: clienteDocumento }] : []),
        { nome: { equals: clienteNome, mode: "insensitive" as const } },
      ],
    },
  });
  if (!cliente) {
    cliente = await tx.cliente.create({
      data: { graficaId, nome: clienteNome, documento: clienteDocumento || null },
    });
  }

  // 2. Item de catálogo placeholder (SERVICO) pro produto descrito em texto
  // livre — dedup por nome exato dentro da gráfica, pra planilha com 200+
  // linhas repetindo os mesmos 5-10 produtos convergir num único item
  // reaproveitado, não N quase-duplicados. ativo=false é o que mantém esse
  // placeholder fora do seletor de item real em /orcamento (que sempre
  // filtra ativo=true) — histórico importado não deve poluir novo orçamento.
  let itemCatalogo = await tx.itemCatalogo.findFirst({
    where: { graficaId, tipo: "SERVICO", nome: produtoDescricao },
  });
  if (!itemCatalogo) {
    itemCatalogo = await tx.itemCatalogo.create({
      data: { graficaId, tipo: "SERVICO", nome: produtoDescricao, categoria: "Histórico (importado)" },
    });
  }

  let itemGrafica = await tx.itemGrafica.findFirst({
    where: { graficaId, itemCatalogoId: itemCatalogo.id },
  });
  if (!itemGrafica) {
    itemGrafica = await tx.itemGrafica.create({
      data: { graficaId, itemCatalogoId: itemCatalogo.id, ativo: false },
    });
  }

  // 3. Orçamento — createdAt é sobrescrito pra dataHistorica de propósito:
  // TODO relatório de faturamento em src/lib/relatorios-negocio.ts bucketiza
  // por Orcamento.createdAt (nunca por outro campo). Sem este override,
  // pedido histórico apareceria como se tivesse sido feito HOJE, corrompendo
  // relatório real da gráfica. precoUnitario = total / quantidade (seguro:
  // quantidade já sai do schema como inteiro >= 1).
  const novoOrcamento = await tx.orcamento.create({
    data: {
      graficaId,
      clienteId: cliente.id,
      usuarioId,
      status: "APROVADO",
      total: valorTotal,
      vendedor: vendedor || null,
      observacoes: observacoes || null,
      createdAt: dataHistorica,
      itens: {
        create: [
          {
            itemGraficaId: itemGrafica.id,
            quantidade,
            precoUnitario: valorTotal / quantidade,
            precoTotal: valorTotal,
          },
        ],
      },
    },
  });

  // 4. Pedido — precoSugeridoTotal/valorNegociadoTotal/custoPrevistoTotal
  // ficam null (default do schema) de propósito: planilha histórica não traz
  // custo/margem, só receita (ver comentário em CAMPOS_PEDIDOS).
  await tx.pedido.create({
    data: {
      graficaId,
      orcamentoId: novoOrcamento.id,
      status: "ENTREGUE",
      aprovadoEm: dataHistorica,
    },
  });

  return { ok: true };
}
