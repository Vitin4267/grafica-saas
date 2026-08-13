import "server-only";
import { z } from "zod";
import { validarWebhookUrl } from "@/lib/webhook-assistente";
import { construirEnvelope } from "@/lib/webhook-envelope";

// Cliente do workflow n8n de "Cálculo de gasto de tinta com IA" — webhook
// ÚNICO da plataforma (mesmo modelo do assistente de chat em
// webhook-assistente.ts: uma conta só, hospedada pelo dono do produto, não
// "traga sua própria conta" por gráfica), porque cada chamada gasta
// armazenamento de imagem + token de IA da PLATAFORMA. Puramente app → n8n
// (síncrono, uma requisição/uma resposta) — o n8n nunca chama o app de
// volta, nunca precisa de credencial nossa.

export type JobParaAnaliseTinta = {
  produtoNome: string;
  modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
  quantidade: number;
  larguraCm: number | null;
  alturaCm: number | null;
  cores: string | null;
  corFrente: number | null;
  corVerso: number | null;
  substrato: string | null;
};

export type SolicitacaoAnaliseTinta = {
  analiseId: string;
  imagemUrl: string;
  imagemTipo: string;
  graficaNome: string;
  job: JobParaAnaliseTinta;
};

export type RespostaAnaliseTintaSucesso = {
  coberturaPercentual: number;
  coberturaPorCor: { ciano: number; magenta: number; amarelo: number; preto: number };
  consumoMlPorPeca: number;
  consumoMlTotal: number;
  confianca: "alta" | "media" | "baixa";
  observacao: string;
  modelo: string | null;
};

export class ErroWebhookTinta extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ErroWebhookTinta";
  }
}

const TIMEOUT_MS = 40_000; // vision leva mais que o chat (15s) — download + inferência + overhead do n8n
const TAMANHO_MAXIMO_RESPOSTA = 20_000;

const coberturaSchema = z.object({
  ciano: z.number().min(0).max(100),
  magenta: z.number().min(0).max(100),
  amarelo: z.number().min(0).max(100),
  preto: z.number().min(0).max(100),
});

// Corte de tamanho ANTES do JSON.parse (não depois, como o assistente faz) —
// a resposta aqui carrega mais campos, vale ser mais estrito.
const respostaSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    analiseId: z.string().min(1),
    coberturaPercentual: z.number().min(0).max(100),
    coberturaPorCor: coberturaSchema,
    consumoMlPorPeca: z.number().positive().max(1000),
    consumoMlTotal: z.number().positive().max(1_000_000),
    confianca: z.enum(["alta", "media", "baixa"]),
    observacao: z.string().max(600),
    modelo: z.string().optional(),
  }),
  z.object({
    ok: z.literal(false),
    analiseId: z.string().min(1),
    erro: z.string().optional(),
  }),
]);

export async function solicitarAnaliseTinta(
  config: { webhookUrl: string; secret: string },
  input: SolicitacaoAnaliseTinta
): Promise<RespostaAnaliseTintaSucesso> {
  const validacao = validarWebhookUrl(config.webhookUrl);
  if (!validacao.ok) {
    throw new ErroWebhookTinta(validacao.mensagem ?? "URL do webhook de tinta inválida.");
  }

  // Montado campo a campo, nunca por spread — mesma disciplina de
  // perguntarAssistente/dispararEventoAutomacao: só o que está listado aqui
  // sai pro webhook. Nunca nome de cliente, preço ou dado fiscal — só o que
  // é matematicamente necessário pra calcular ml de tinta.
  const corpo = JSON.stringify(
    construirEnvelope("analise_tinta_solicitada", {
      analiseId: input.analiseId,
      imagemUrl: input.imagemUrl,
      imagemTipo: input.imagemTipo,
      graficaNome: input.graficaNome,
      job: {
        produtoNome: input.job.produtoNome,
        modeloCalculo: input.job.modeloCalculo,
        quantidade: input.job.quantidade,
        larguraCm: input.job.larguraCm,
        alturaCm: input.job.alturaCm,
        cores: input.job.cores,
        corFrente: input.job.corFrente,
        corVerso: input.job.corVerso,
        substrato: input.job.substrato,
      },
    })
  );

  let resposta: Response;
  try {
    resposta = await fetch(config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Tinta-Secret": config.secret },
      body: corpo,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "error", // não segue redirect — evita um 3xx contornar a validação de host acima
    });
  } catch (erro) {
    if (erro instanceof Error && erro.name === "TimeoutError") {
      throw new ErroWebhookTinta("A análise demorou demais pra responder. Tente novamente.");
    }
    throw new ErroWebhookTinta("Não consegui falar com o serviço de análise agora.");
  }

  if (!resposta.ok) {
    throw new ErroWebhookTinta(`O serviço de análise respondeu com erro (HTTP ${resposta.status}).`);
  }

  const bruto = await resposta.text();
  if (bruto.length > TAMANHO_MAXIMO_RESPOSTA) {
    throw new ErroWebhookTinta("O serviço de análise devolveu uma resposta grande demais.");
  }

  let json: unknown;
  try {
    json = JSON.parse(bruto);
  } catch {
    throw new ErroWebhookTinta("O serviço de análise devolveu uma resposta inválida.");
  }

  const parsed = respostaSchema.safeParse(json);
  if (!parsed.success) {
    throw new ErroWebhookTinta("O serviço de análise devolveu um formato inesperado.");
  }
  if (!parsed.data.ok) {
    throw new ErroWebhookTinta(parsed.data.erro || "Não foi possível analisar a imagem.");
  }
  // Proteção barata contra resposta trocada/em cache do n8n — o id que volta
  // tem que ser o mesmo que foi enviado.
  if (parsed.data.analiseId !== input.analiseId) {
    throw new ErroWebhookTinta("A resposta da análise não corresponde ao pedido enviado.");
  }

  return {
    coberturaPercentual: parsed.data.coberturaPercentual,
    coberturaPorCor: parsed.data.coberturaPorCor,
    consumoMlPorPeca: parsed.data.consumoMlPorPeca,
    consumoMlTotal: parsed.data.consumoMlTotal,
    confianca: parsed.data.confianca,
    observacao: parsed.data.observacao,
    modelo: parsed.data.modelo ?? null,
  };
}
