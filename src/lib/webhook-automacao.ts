import "server-only";
import { prisma } from "@/lib/prisma";
import { validarWebhookUrl } from "@/lib/webhook-assistente";
import { construirEnvelope } from "@/lib/webhook-envelope";

// Eventos do hub de automação — disparados fire-and-forget pro webhook n8n
// (ou qualquer outro) que a PRÓPRIA gráfica configura em
// /configuracoes/automacao (AutomacaoGrafica.webhookUrl). Cada payload é
// montado campo a campo (nunca spread de objeto interno) — mesma disciplina
// de webhook-assistente.ts, mesmo carregando dado de negócio agora.
export type EventoAutomacao =
  | {
      tipo: "pedido_status_mudou";
      graficaNome: string;
      clienteNome: string;
      clienteTelefone: string | null;
      statusAnterior: string;
      statusNovo: string;
      orcamentoId: string;
    }
  | {
      tipo: "estoque_critico";
      graficaNome: string;
      itemNome: string;
      estoqueAtual: number;
      estoqueMinimo: number;
    }
  | {
      tipo: "pedido_atrasado";
      graficaNome: string;
      clienteNome: string;
      clienteTelefone: string | null;
      status: string;
      prazoEntrega: string;
      diasAtraso: number;
      orcamentoId: string;
      // Achado C2 da auditoria de abrangência (Parte 2/Produção,
      // 2026-09-01) — decisão de escopo: em vez de alterar o CÁLCULO do
      // atraso (mexer em diasAtraso/prazoEntrega descontando tempo parado
      // exigiria decidir regras de negócio novas — ex: parada conta contra
      // o prazo se for culpa da gráfica mas não se for do cliente — fora do
      // escopo desta rodada, ver relatório da tarefa), só ANOTA o payload:
      // quanto tempo (em dias, arredondado) este pedido já ficou parado no
      // total (soma de todas as ParadaPedido, ativas contam até agora) e se
      // há uma parada ativa neste exato momento. Quem consome o webhook (a
      // automação n8n da própria gráfica) decide o que fazer com isso — ex:
      // não cobrar o cliente por um atraso que é espera de material dele
      // mesmo.
      diasParado: number;
      pausadoAtualmente: boolean;
    }
  | {
      // Achado E1 da auditoria de abrangência (Parte 2/Produção,
      // 2026-09-01) — mesmo motor de alerta de pedido_atrasado acima
      // (verificarEDispararAlertasAtraso, src/lib/alerta-atraso.ts), só que
      // pra EtapaTerceirizada.previsaoRetorno vencida com situacao=ENVIADO:
      // o pedido em si pode não estar atrasado, mas o terceiro está.
      tipo: "terceirizacao_atrasada";
      graficaNome: string;
      clienteNome: string;
      clienteTelefone: string | null;
      fornecedorNome: string;
      previsaoRetorno: string;
      diasAtraso: number;
      orcamentoId: string;
    };

const TIMEOUT_MS = 5_000; // bem menor que o do chat (15s) — ninguém na UI está esperando resposta

export type AutomacaoConfig = {
  webhookUrl: string | null;
  notificarStatusMudou: boolean;
  notificarEstoqueCritico: boolean;
  notificarPedidoAtrasado: boolean;
};

// Uma query só devolvendo webhookUrl + os 3 toggles por tipo (ver
// /configuracoes/automacao) — quem chama decide, por tipo de evento, se
// notificarXxx está ligado antes de disparar. Se a gráfica nunca visitou
// /configuracoes/automacao (linha ainda não existe), os toggles caem no
// mesmo default `true` do schema — mas como webhookUrl vem null nesse caso,
// nada dispara de qualquer forma.
export async function buscarAutomacaoGrafica(graficaId: string): Promise<AutomacaoConfig> {
  const automacao = await prisma.automacaoGrafica.findUnique({
    where: { graficaId },
    select: {
      webhookUrl: true,
      notificarStatusMudou: true,
      notificarEstoqueCritico: true,
      notificarPedidoAtrasado: true,
    },
  });
  return {
    webhookUrl: automacao?.webhookUrl ?? null,
    notificarStatusMudou: automacao?.notificarStatusMudou ?? true,
    notificarEstoqueCritico: automacao?.notificarEstoqueCritico ?? true,
    notificarPedidoAtrasado: automacao?.notificarPedidoAtrasado ?? true,
  };
}

// Nunca lança erro pra cima — uma automação falhando não pode derrubar a
// ação principal do usuário (avançar pedido, dar baixa em estoque). Sempre
// "melhor esforço": valida a URL, dispara, e engole qualquer problema (rede,
// timeout, resposta não-2xx). Não lê o corpo da resposta do n8n.
export async function dispararEventoAutomacao(
  webhookUrl: string,
  evento: EventoAutomacao
): Promise<void> {
  try {
    const validacao = validarWebhookUrl(webhookUrl);
    if (!validacao.ok) return;

    const { tipo, ...dados } = evento;
    const corpo = JSON.stringify(construirEnvelope(tipo, dados));

    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error",
    });
  } catch {
    // melhor esforço — falha aqui nunca deve aparecer pro usuário
  }
}
