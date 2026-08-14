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
  // Identifica a conversa pro workflow n8n poder dar memória ao assistente
  // (ex: node "Postgres Chat Memory") — sempre prefixado com o graficaId no
  // servidor (ver ChatAssistente.actions.ts), nunca aceito cru do cliente,
  // pra duas gráficas nunca poderem colidir no mesmo histórico de conversa.
  sessaoId: string;
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

// Teto de bytes pro corpo bruto da resposta do webhook, compartilhado entre
// este arquivo e webhook-tinta.ts. Existe porque `Response.text()` bufferiza
// o corpo INTEIRO na memória antes de qualquer corte por tamanho de string
// rodar — um workflow n8n com bug (ex: um nó devolvendo uma imagem em
// base64 inline por engano) podia estourar a memória da function serverless
// dentro da janela de timeout, muito antes do JSON.parse ou de qualquer
// checagem de tamanho de texto entrar em ação. 2 MB é folgado o bastante pra
// qualquer resposta legítima (texto de chat ou o JSON de análise de tinta,
// que já se limita a 20.000 caracteres) e pequeno o bastante pra não pesar
// na memória da function.
const LIMITE_BYTES_RESPOSTA_WEBHOOK = 2 * 1024 * 1024;

// Lê o corpo da resposta pelo stream, abortando cedo se ultrapassar
// `limiteBytes` — ao contrário de `resposta.text()`, nunca chega a
// bufferizar mais do que o limite na memória.
export async function lerCorpoComLimite(
  resposta: Response,
  limiteBytes: number = LIMITE_BYTES_RESPOSTA_WEBHOOK
): Promise<string> {
  const reader = resposta.body?.getReader();
  if (!reader) return resposta.text();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limiteBytes) {
      await reader.cancel();
      throw new Error("Resposta do webhook excedeu o tamanho máximo permitido.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

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
function ipv4EhPrivadoOuReservado(ip: string): boolean {
  const octetos = ip.split(".").map(Number);
  const [a, b, c] = octetos;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true; // inclui metadata de nuvem
  if (a === 0) return true;
  // Faixas que faltavam (achado da auditoria de 2026-07-26):
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10, CGNAT — inclui metadata da Alibaba Cloud (100.100.100.200)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15, benchmarking
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24, IETF Protocol Assignments
  return false;
}

// Extrai o IPv4 de dentro de um endereço IPv4-mapeado em IPv6
// (`::ffff:a.b.c.d` ou a forma hex comprimida `::ffff:7f00:1` que
// `new URL(...).hostname` produz depois de normalizar) ou do formato
// IPv4-compatível legado (`::a.b.c.d`). Sockets dual-stack (padrão na
// maioria dos SOs) tratam esses endereços como o IPv4 real por baixo —
// sem essa extração, `https://[::ffff:169.254.169.254]/` (ou qualquer
// faixa privada mapeada) escapava do bloqueio de IPv4 abaixo.
function extrairIpv4MapeadoEmIpv6(host: string): string | null {
  const dotted = /^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(host);
  if (dotted) return dotted[1];

  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
  if (hex) {
    const alto = parseInt(hex[1], 16);
    const baixo = parseInt(hex[2], 16);
    return [(alto >> 8) & 0xff, alto & 0xff, (baixo >> 8) & 0xff, baixo & 0xff].join(".");
  }
  return null;
}

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
    return ipv4EhPrivadoOuReservado(host);
  }
  if (versaoIp === 6) {
    if (host === "::1") return true;
    if (host === "::") return true; // não-especificado — roteia pra loopback em dual-stack
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // fc00::/7
    if (host.startsWith("fe80:")) return true; // link-local
    if (host.startsWith("64:ff9b::")) return true; // NAT64 (RFC 6052) — mesmo raciocínio do IPv4-mapeado abaixo

    const ipv4Mapeado = extrairIpv4MapeadoEmIpv6(host);
    if (ipv4Mapeado && ipv4EhPrivadoOuReservado(ipv4Mapeado)) return true;

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
      sessaoId: input.sessaoId,
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

  let bruto: string;
  try {
    bruto = await lerCorpoComLimite(resposta);
  } catch {
    throw new ErroWebhookAssistente("O assistente devolveu uma resposta grande demais.");
  }

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
