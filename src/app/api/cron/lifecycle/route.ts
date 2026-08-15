import { NextRequest } from "next/server";
import { enviarAvisosTrialExpirando, enviarMetricasDiarias, reconciliarArmazenamento } from "@/lib/lifecycle-cron";
import { enviarAlertasPrazoEmail } from "@/lib/alerta-prazo-email";
import { cronAutorizado } from "@/lib/auth/cron";

// Cron diário (vercel.json) de "ciclo de vida" da plataforma: 1) aviso de
// trial acabando (e-mail via EMAIL_WEBHOOK_URL), 2) métricas agregadas de
// negócio pro n8n (via METRICAS_WEBHOOK_URL), 3) reconciliação da cota de
// armazenamento e 4) alerta de prazo de entrega por e-mail (5/3/0 dias, ver
// src/lib/alerta-prazo-email.ts — canal separado do alerta_atraso sob
// demanda que já existia). Junta tudo numa única rota (em vez de várias),
// já que todas são "melhor esforço, roda 1x/dia, sem efeito colateral uma
// na outra" — mesmo raciocínio de manter poucas rotas de cron (o plano
// grátis da Vercel tem limite de crons).
//
// maxDuration explícito: a terceira tarefa do Promise.all abaixo
// (reconciliarArmazenamento, ver src/lib/lifecycle-cron.ts) faz uma
// query+head() de rede por pedido/gráfica no backfill — sem isso, o default
// de 15s do plano Hobby/Pro (mesmo default citado em
// src/app/orcamento/[id]/page.tsx) estoura bem antes da base crescer,
// matando o cron NO MEIO e derrubando as outras duas tarefas junto (nenhuma
// delas completa quando o Promise.all é abortado). 60s dá folga: o backfill
// agora roda em lotes paralelos de 10 (ver TAMANHO_LOTE_BACKFILL), mas ainda
// é uma chamada de rede por linha.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  // Mesma proteção de src/app/api/cron/backup/route.ts: só a própria infra
  // da Vercel (ou quem souber o segredo) consegue disparar.
  if (!cronAutorizado(request.headers.get("authorization"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Mesma prioridade de src/lib/url-publica.ts (APP_URL > origem da
  // requisição) — implementada aqui direto a partir do NextRequest, sem
  // precisar de next/headers (não disponível/necessário fora de Server
  // Components) pra montar o link que vai dentro do e-mail de trial.
  const origemPublica = (process.env.APP_URL ?? request.nextUrl.origin).replace(/\/+$/, "");

  // Promise.allSettled em vez de Promise.all: as quatro tarefas são
  // independentes (ver comentário do arquivo), mas Promise.all também as
  // acopla por ERRO — se uma rejeitar (ex: instabilidade do Vercel Blob no
  // list() de reconciliarArmazenamento), a rota inteira responde 500 e o
  // resultado das outras, que podem ter terminado normalmente, nunca é
  // reportado. Cada resultado é reportado individualmente abaixo; "ok"
  // reflete se TODAS as quatro tarefas terminaram sem lançar.
  const [avisosTrial, metricas, armazenamento, alertasPrazo] = await Promise.allSettled([
    enviarAvisosTrialExpirando(origemPublica),
    enviarMetricasDiarias(),
    reconciliarArmazenamento(),
    enviarAlertasPrazoEmail(origemPublica),
  ]);

  return Response.json({
    ok: [avisosTrial, metricas, armazenamento, alertasPrazo].every((r) => r.status === "fulfilled"),
    avisosTrial: avisosTrial.status === "fulfilled" ? avisosTrial.value : { erro: String(avisosTrial.reason) },
    metricas: metricas.status === "fulfilled" ? metricas.value : { erro: String(metricas.reason) },
    armazenamento: armazenamento.status === "fulfilled" ? armazenamento.value : { erro: String(armazenamento.reason) },
    alertasPrazo: alertasPrazo.status === "fulfilled" ? alertasPrazo.value : { erro: String(alertasPrazo.reason) },
  });
}
