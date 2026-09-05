import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizarTelefone } from "@/lib/telefone";
import { buscarAutomacaoGrafica, dispararEventoAutomacao } from "@/lib/webhook-automacao";

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
  const automacao = await buscarAutomacaoGrafica(graficaId);
  if (!automacao.webhookUrl) return; // sem webhook configurado, nada a fazer
  if (!automacao.notificarPedidoAtrasado) return; // tipo desligado pra esta gráfica
  const webhookUrl = automacao.webhookUrl;

  const hojeUTC = new Date();
  hojeUTC.setUTCHours(0, 0, 0, 0);

  const pedidosAtrasados = await prisma.pedido.findMany({
    where: {
      graficaId,
      status: { notIn: ["ENTREGUE", "CANCELADO"] },
      prazoEntrega: { lt: hojeUTC },
      alertaAtrasoEnviadoEm: null,
    },
    include: {
      orcamento: { include: { cliente: true } },
      // Achado C2 da auditoria de abrangência (Parte 2/Produção,
      // 2026-09-01) — só pra anotar diasParado/pausadoAtualmente no payload
      // abaixo (ver comentário grande em EventoAutomacao["pedido_atrasado"]
      // em src/lib/webhook-automacao.ts sobre a decisão de escopo: NÃO
      // altera diasAtraso/prazoEntrega, só informa a mais).
      paradas: { select: { iniciadaEm: true, finalizadaEm: true } },
    },
  });

  for (const pedido of pedidosAtrasados) {
    const prazoEntrega = pedido.prazoEntrega!;

    // Compare-and-swap ANTES de disparar o webhook — achado de auditoria
    // pré-lançamento (2026-08-15): como esta função roda sob demanda a cada
    // carregamento de /producao (não é cron com lock), duas requisições
    // concorrentes (duas abas, dois funcionários abrindo a tela quase
    // juntos) podiam ambas ver alertaAtrasoEnviadoEm: null na query acima e
    // disparar o evento pedido_atrasado 2x antes que qualquer uma marcasse
    // o campo — virando notificação duplicada pro cliente final, se a
    // automação da gráfica notifica por WhatsApp/e-mail. Marcando primeiro
    // (e só disparando se a marcação teve sucesso), a segunda tentativa
    // concorrente sempre casa zero linhas no updateMany e não dispara nada.
    const cas = await prisma.pedido.updateMany({
      where: { id: pedido.id, alertaAtrasoEnviadoEm: null },
      data: { alertaAtrasoEnviadoEm: new Date() },
    });
    if (cas.count === 0) continue;

    // Achado C2 — soma o tempo de TODAS as paradas deste pedido (fechadas:
    // finalizadaEm-iniciadaEm; a ativa, se houver: agora-iniciadaEm) — só
    // informativo, ver comentário grande em EventoAutomacao["pedido_atrasado"].
    const msParado = pedido.paradas.reduce((soma, parada) => {
      const fim = parada.finalizadaEm ? parada.finalizadaEm.getTime() : Date.now();
      return soma + Math.max(0, fim - parada.iniciadaEm.getTime());
    }, 0);
    const diasParado = Math.round(msParado / MS_POR_DIA);
    const pausadoAtualmente = pedido.paradas.some((p) => p.finalizadaEm === null);

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
        diasParado,
        pausadoAtualmente,
      })
    );
  }

  // Achado E1 da auditoria de abrangência (Parte 2/Produção, 2026-09-01) —
  // MESMO motor de alerta acima (mesma automacao/webhookUrl/toggle
  // notificarPedidoAtrasado já resolvidos, mesma filosofia sob-demanda +
  // CAS de dedup), agora pra EtapaTerceirizada.previsaoRetorno vencida
  // enquanto ainda ENVIADO — o pedido em si pode não estar atrasado
  // (prazoEntrega ainda longe), mas o terceiro está sumido. Dedup em
  // EtapaTerceirizada.alertaAtrasoEnviadoEm (campo próprio, não
  // Pedido.alertaAtrasoEnviadoEm — os dois vencimentos são independentes).
  const terceirizacoesAtrasadas = await prisma.etapaTerceirizada.findMany({
    where: {
      graficaId,
      situacao: "ENVIADO",
      previsaoRetorno: { lt: hojeUTC },
      alertaAtrasoEnviadoEm: null,
    },
    include: {
      fornecedor: { select: { nome: true } },
      pedido: { include: { orcamento: { include: { cliente: true } } } },
    },
  });

  for (const etapa of terceirizacoesAtrasadas) {
    const previsaoRetorno = etapa.previsaoRetorno!;

    // Mesmo CAS de pedidosAtrasados acima — evita disparo duplicado quando
    // duas requisições concorrentes carregam /producao quase juntas.
    const cas = await prisma.etapaTerceirizada.updateMany({
      where: { id: etapa.id, alertaAtrasoEnviadoEm: null },
      data: { alertaAtrasoEnviadoEm: new Date() },
    });
    if (cas.count === 0) continue;

    after(() =>
      dispararEventoAutomacao(webhookUrl, {
        tipo: "terceirizacao_atrasada",
        graficaNome,
        clienteNome: etapa.pedido.orcamento.cliente.nome,
        clienteTelefone: normalizarTelefone(etapa.pedido.orcamento.cliente.telefone),
        fornecedorNome: etapa.fornecedor?.nome ?? etapa.fornecedorNome ?? "Fornecedor não informado",
        previsaoRetorno: previsaoRetorno.toISOString().slice(0, 10),
        diasAtraso: Math.floor((hojeUTC.getTime() - previsaoRetorno.getTime()) / MS_POR_DIA),
        orcamentoId: etapa.pedido.orcamentoId,
      })
    );
  }
}
