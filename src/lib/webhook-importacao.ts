import "server-only";
import { z } from "zod";
import { validarWebhookUrl, lerCorpoComLimite } from "@/lib/webhook-assistente";
import { construirEnvelope } from "@/lib/webhook-envelope";

// Cliente do workflow n8n do "Importador de planilha com IA" — webhook ÚNICO
// da plataforma (mesmo modelo de webhook-tinta.ts/webhook-assistente.ts:
// uma conta só, hospedada pelo dono do produto), porque cada chamada gasta
// token de IA da PLATAFORMA. Só sugere MAPEAMENTO de coluna — nunca recebe a
// planilha inteira nem escreve no banco; a importação de verdade acontece
// depois, em código determinístico (ver src/lib/importacao/planilha.ts).

export type SolicitacaoMapeamentoPlanilha = {
  mapeamentoId: string;
  tipo: "CLIENTES" | "CATALOGO" | "PEDIDOS";
  graficaNome: string;
  // Um dos valores aceitáveis pra cada coluna (inclui "ignorar") — a IA deve
  // responder só com valores desta lista; o servidor revalida de qualquer
  // forma, nunca confia cegamente na string que voltar.
  camposDisponiveis: string[];
  cabecalhos: string[]; // colunas da planilha, na ordem original
  // Só umas poucas linhas reais (nunca a planilha inteira), cada uma
  // paralela a `cabecalhos` — célula já truncada pelo chamador antes de sair
  // do servidor (ver amostraParaIA em src/lib/importacao/planilha.ts).
  linhasAmostra: string[][];
};

export type SugestaoColunaPlanilha = {
  indice: number;
  campo: string;
  confianca: "alta" | "media" | "baixa";
};

export type RespostaMapeamentoPlanilha = { sugestoes: SugestaoColunaPlanilha[] };

export class ErroWebhookImportacao extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroWebhookImportacao";
  }
}

const TIMEOUT_MS = 30_000; // texto puro, sem download de imagem — entre o chat (15s) e a tinta (40s)
// Maior que a tinta (20_000): a resposta carrega uma sugestão por COLUNA da
// planilha (até MAX_COLUNAS_PLANILHA), não um punhado de números fixos.
const TAMANHO_MAXIMO_RESPOSTA = 100_000;
const MAX_SUGESTOES = 60; // teto = MAX_COLUNAS_PLANILHA (ver importacao/planilha.ts)

const respostaSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    mapeamentoId: z.string().min(1),
    sugestoes: z
      .array(
        z.object({
          indice: z.number().int().min(0),
          campo: z.string().min(1).max(60),
          confianca: z.enum(["alta", "media", "baixa"]),
        })
      )
      .max(MAX_SUGESTOES),
  }),
  z.object({
    ok: z.literal(false),
    mapeamentoId: z.string().min(1),
    erro: z.string().optional(),
  }),
]);

export async function solicitarMapeamentoPlanilha(
  config: { webhookUrl: string; secret: string },
  input: SolicitacaoMapeamentoPlanilha
): Promise<RespostaMapeamentoPlanilha> {
  const validacao = validarWebhookUrl(config.webhookUrl);
  if (!validacao.ok) {
    throw new ErroWebhookImportacao(validacao.mensagem ?? "URL do webhook de importação inválida.");
  }

  // Montado campo a campo, nunca por spread — mesma disciplina de
  // webhook-tinta.ts: só o que está listado aqui sai pro webhook.
  const corpo = JSON.stringify(
    construirEnvelope("mapeamento_planilha_solicitado", {
      mapeamentoId: input.mapeamentoId,
      tipo: input.tipo,
      graficaNome: input.graficaNome,
      camposDisponiveis: input.camposDisponiveis,
      cabecalhos: input.cabecalhos,
      linhasAmostra: input.linhasAmostra,
    })
  );

  let resposta: Response;
  try {
    resposta = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Importacao-Secret": config.secret },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error", // não segue redirect — evita um 3xx contornar a validação de host acima
    });
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") {
      throw new ErroWebhookImportacao("A sugestão de mapeamento demorou demais pra responder. Tente novamente.");
    }
    throw new ErroWebhookImportacao("Não consegui falar com o serviço de importação agora.");
  }

  if (!resposta.ok) {
    throw new ErroWebhookImportacao(`O serviço de importação respondeu com erro (HTTP ${resposta.status}).`);
  }

  let bruto: string;
  try {
    bruto = await lerCorpoComLimite(resposta);
  } catch {
    throw new ErroWebhookImportacao("O serviço de importação devolveu uma resposta grande demais.");
  }
  if (bruto.length > TAMANHO_MAXIMO_RESPOSTA) {
    throw new ErroWebhookImportacao("O serviço de importação devolveu uma resposta grande demais.");
  }

  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    throw new ErroWebhookImportacao("O serviço de importação devolveu uma resposta inválida.");
  }

  const parsed = respostaSchema.safeParse(json);
  if (!parsed.success) {
    throw new ErroWebhookImportacao("O serviço de importação devolveu um formato inesperado.");
  }
  if (!parsed.data.ok) {
    throw new ErroWebhookImportacao(parsed.data.erro || "Não foi possível sugerir o mapeamento.");
  }
  // Proteção barata contra resposta trocada/em cache do n8n — o id que volta
  // tem que ser o mesmo que foi enviado.
  if (parsed.data.mapeamentoId !== input.mapeamentoId) {
    throw new ErroWebhookImportacao("A resposta não corresponde ao pedido enviado.");
  }

  return { sugestoes: parsed.data.sugestoes };
}
