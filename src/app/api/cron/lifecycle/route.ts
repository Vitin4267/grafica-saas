import { NextRequest } from "next/server";
import { enviarAvisosTrialExpirando, enviarMetricasDiarias, reconciliarArmazenamento } from "@/lib/lifecycle-cron";
import { cronAutorizado } from "@/lib/auth/cron";

// Cron diário (vercel.json) de "ciclo de vida" da plataforma: 1) aviso de
// trial acabando (e-mail via EMAIL_WEBHOOK_URL) e 2) métricas agregadas de
// negócio pro n8n (via METRICAS_WEBHOOK_URL). Junta os dois numa única rota
// (em vez de duas), já que ambos são "melhor esforço, roda 1x/dia, sem
// efeito colateral um no outro" — mesmo raciocínio de manter poucas rotas
// de cron (o plano grátis da Vercel tem limite de crons).
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

  const [avisosTrial, metricas, armazenamento] = await Promise.all([
    enviarAvisosTrialExpirando(origemPublica),
    enviarMetricasDiarias(),
    reconciliarArmazenamento(),
  ]);

  return Response.json({
    ok: true,
    avisosTrial,
    metricas,
    armazenamento,
  });
}
