import "server-only";
import { isIP } from "node:net";
import { construirEnvelope } from "./webhook-envelope";

// Cliente do assistente de IA "guia de uso" — NUNCA lida com dado de negócio
// (orçamento, cliente, valor, pagamento, nota fiscal). O único payload que
// este arquivo sabe montar é { pergunta, pagina, graficaNome } — reforçado
// pelo tipo `PerguntaAssistente` abaixo, que não aceita mais nenhum campo.
// A IA de verdade roda fora do grafica-saas, num workflow n8n que a PRÓPRIA
// gráfica configura (mesmo modelo de "traga sua própria conta" já usado na
// emissão de Nota Fiscal via Focus NFe — ver src/lib/focus-nfe.ts).
//
// O corpo enviado sai envelopado (idEvento/tipo/timestamp/versao/dados, ver
// webhook-envelope.ts) — é o mesmo formato de mensagem usado pelos eventos
// de automação (webhook-automacao.ts), tudo passando pelo mesmo webhook
// configurado pela gráfica ("hub único" de automação).

export type PerguntaAssistente = {
  pergunta: string;
  pagina: string;
  graficaNome: string;
};

export type RespostaAssistente = { resposta: string };

export class ErroWebhookAssistente extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroWebhookAssistente";
  }
}

const TIMEOUT_MS = 15_000;
const TAMANHO_MAXIMO_RESPOSTA = 4000; // evita renderizar uma resposta absurdamente grande no chat

// Faixas de IP privadas/reservadas (RFC 1918, loopback, link-local — inclui
// 169.254.169.254, o endereço de metadata da AWS/GCP/Azure) e o hostname
// "localhost". Guarda proporcional pra uma URL que um ADMIN AUTENTICADO da
// própria gráfica configura pro recurso dele mesmo — não é hardening contra
// ataque anônimo, é uma rede de segurança contra erro de configuração ou
// conta comprometida apontando o servidor pra rede interna.
//
// Limitação assumida: isso valida a string da URL, não resolve DNS — não
// protege contra DNS rebinding (hostname que resolve pra IP público na
// validação e IP privado na hora da chamada de verdade). Fechar essa brecha
// de vez exigiria resolver DNS e fixar a chamada por IP, desproporcional
// pro nível de confiança de um admin configurando o próprio webhook.
function hostnameEhPrivadoOuReservado(hostname: string): boolean {
  // `new URL(...).hostname` mantém os colchetes em endereços IPv6 (ex:
  // "[::1]") — precisam ser removidos antes de comparar/checar com isIP,
  // senão nenhum literal IPv6 nunca bate com os checks abaixo.
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }

  const versaoIp = isIP(host);
  if (versaoIp === 4) {
    const octetos = host.split(".").map(Number);
    const [a, b] = octetos;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // inclui metadata de nuvem
    if (a === 0) return true;
    return false;
  }
  if (versaoIp === 6) {
    if (host === "::1") return true;
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // fc00::/7
    if (host.startsWith("fe80:")) return true; // link-local
    return false;
  }

  return false;
}

export function validarWebhookUrl(valor: string): { ok: boolean; mensagem?: string } {
  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    return { ok: false, mensagem: "URL inválida." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, mensagem: "A URL do webhook precisa começar com https://." };
  }
  if (hostnameEhPrivadoOuReservado(url.hostname)) {
    return { ok: false, mensagem: "Essa URL aponta pra um endereço interno/privado, não permitido." };
  }

  return { ok: true };
}

function respostaEhValida(json: unknown): json is RespostaAssistente {
  return (
    typeof json === "object" &&
    json !== null &&
    "resposta" in json &&
    typeof (json as Record<string, unknown>).resposta === "string"
  );
}

export async function perguntarAssistente(
  config: { webhookUrl: string },
  input: PerguntaAssistente
): Promise<RespostaAssistente> {
  const validacao = validarWebhookUrl(config.webhookUrl);
  if (!validacao.ok) {
    throw new ErroWebhookAssistente(validacao.mensagem ?? "URL do webhook inválida.");
  }

  // Dados montados campo a campo (nunca um spread de `input` ou de qualquer
  // outro objeto) — garante, mesmo que um chamador futuro passe algo a mais
  // por engano, que só estes três campos saem pro webhook do tenant.
  const corpo = JSON.stringify(
    construirEnvelope("pergunta_assistente", {
      pergunta: input.pergunta,
      pagina: input.pagina,
      graficaNome: input.graficaNome,
    })
  );

  let resposta: Response;
  try {
    resposta = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error", // não segue redirect — evita um 3xx contornar a validação de host acima
    });
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") {
      throw new ErroWebhookAssistente("O assistente demorou demais pra responder. Tente novamente.");
    }
    throw new ErroWebhookAssistente("Não consegui falar com o assistente agora.");
  }

  if (!resposta.ok) {
    throw new ErroWebhookAssistente(`O assistente respondeu com erro (HTTP ${resposta.status}).`);
  }

  const bruto = await resposta.text();
  const json = (() => {
    try {
      return JSON.parse(bruto);
    } catch {
      return null;
    }
  })();

  const texto = respostaEhValida(json) ? json.resposta : bruto;
  if (!texto || !texto.trim()) {
    throw new ErroWebhookAssistente("O assistente não devolveu nenhuma resposta.");
  }

  return { resposta: texto.slice(0, TAMANHO_MAXIMO_RESPOSTA) };
}
