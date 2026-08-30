// Parte de contrato-fornecimento.ts que TOCA o banco — separada pra
// contrato-fornecimento.ts poder ficar livre de "@/lib/prisma" (importado
// por NovaSolicitacaoForm, um Client Component). Ver comentário de topo de
// contrato-fornecimento.ts.

import { prisma } from "@/lib/prisma";
import { calcularAlertaContrato, type ContratoProximoDoLimite } from "@/lib/contrato-fornecimento";

// Só contratos ATIVOS (ativo=false já saiu de circulação, não vale a pena
// avisar sobre algo que ninguém mais usa) com vigência perto do fim OU
// consumo perto do teto — ver calcularAlertaContrato. Consumida pela tela de
// Compras (aviso no topo, mesmo espírito de "Sugestões por estoque baixo")
// e pela listagem de Contratos de fornecimento.
export async function listarContratosProximosDoLimite(graficaId: string): Promise<ContratoProximoDoLimite[]> {
  const contratos = await prisma.contratoFornecimento.findMany({
    where: { graficaId, ativo: true },
    include: {
      fornecedor: { select: { nome: true } },
      itemGrafica: { include: { itemCatalogo: { select: { nome: true } } } },
    },
  });

  const agora = new Date();

  return contratos
    .map((c) => {
      const quantidadeContratada = c.quantidadeContratada !== null ? Number(c.quantidadeContratada) : null;
      const quantidadeConsumida = Number(c.quantidadeConsumida);
      const alerta = calcularAlertaContrato(
        { id: c.id, quantidadeContratada, quantidadeConsumida, vigenciaFim: c.vigenciaFim },
        agora
      );
      return {
        id: c.id,
        fornecedorNome: c.fornecedor.nome,
        itemNome: c.itemGrafica?.itemCatalogo.nome ?? null,
        vigenciaFim: c.vigenciaFim,
        quantidadeContratada,
        quantidadeConsumida,
        ...alerta,
      };
    })
    .filter((c) => c.vigenciaProxima || c.quantidadeProxima);
}
