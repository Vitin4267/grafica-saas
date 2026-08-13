import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizarTelefone } from "@/lib/telefone";
import { buscarWebhookAutomacao, dispararEventoAutomacao } from "@/lib/webhook-automacao";

const MS_POR_DIA = 86_400_000;

// Roda sob demanda (não é cron) a cada carregamento de /producao — mesma
// filosofia de gerarDespesasRecorrentesPendentes (src/lib/despesa-recorrente.ts)
// e calcularPrevisaoEstoque (src/lib/previsao-estoque-db.ts): sem depender de
// infraestrutura de hospedagem ainda não decidida. Dispara o evento
// pedido_atrasado uma única vez por pedido (Pedido.alertaAtrasoEnviadoEm),
// nunca repete enquanto o pedido continua atrasado.
export async function verificarEDispararAlertasAtraso(
  graficaId: string,
  graficaNome: string
): Promise<void> {
  const webhookUrl = await buscarWebhookAutomacao(graficaId);
  if (!webhookUrl) return; // sem webhook configurado, nada a fazer

  const hojeUTC = new Date();
  hojeUTC.setUTCHours(0, 0, 0, 0);

  const pedidosAtrasados = await prisma.pedido.findMany({
    where: {
      graficaId,
      status: { notIn: ["ENTREGUE", "CANCELADO"] },
      prazoEntrega: { lt: hojeUTC },
      alertaAtrasoEnviadoEm: null,
    },
    include: { orcamento: { include: { cliente: true } } },
  });

  for (const pedido of pedidosAtrasados) {
    const prazoEntrega = pedido.prazoEntrega!;
    // after() em vez de void: garante que a instância serverless continua
    // viva até o webhook terminar, mesmo depois da resposta (render da
    // página /producao) já ter sido enviada ao cliente.
    after(() =>
      dispararEventoAutomacao(webhookUrl, {
        tipo: "pedido_atrasado",
        graficaNome,
        clienteNome: pedido.orcamento.cliente.nome,
        clienteTelefone: normalizarTelefone(pedido.orcamento.cliente.telefone),
        status: pedido.status,
        prazoEntrega: prazoEntrega.toISOString().slice(0, 10),
        diasAtraso: Math.floor((hojeUTC.getTime() - prazoEntrega.getTime()) / MS_POR_DIA),
        orcamentoId: pedido.orcamentoId,
      })
    );

    await prisma.pedido.update({
      where: { id: pedido.id },
      data: { alertaAtrasoEnviadoEm: new Date() },
    });
  }
}
