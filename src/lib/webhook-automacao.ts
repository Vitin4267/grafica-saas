import "server-only";
import { prisma } from "@/lib/prisma";
import { validarWebhookUrl } from "@/lib/webhook-assistente";
import { construirEnvelope } from "@/lib/webhook-envelope";

// Eventos do hub de automação — disparados fire-and-forget pro mesmo webhook
// n8n que a gráfica já configura em /configuracoes/assistente (mesmo campo
// AssistenteGrafica.webhookUrl usado pelo chat). Cada payload é montado
// campo a campo (nunca spread de objeto interno) — mesma disciplina de
// webhook-assistente.ts, mesmo carregando dado de negócio agora.
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
    };

const TIMEOUT_MS = 5_000; // bem menor que o do chat (15s) — ninguém na UI está esperando resposta

export async function buscarWebhookAutomacao(graficaId: string): Promise<string | null> {
  const assistente = await prisma.assistenteGrafica.findUnique({ where: { graficaId } });
  return assistente?.webhookUrl ?? null;
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
