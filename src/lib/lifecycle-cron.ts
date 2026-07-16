import "server-only";
import { prisma } from "@/lib/prisma";
import { dispararEventoEmail } from "@/lib/email/webhook-email";
import { templateTrialExpirando } from "@/lib/email/templates";
import { dispararMetrica } from "@/lib/webhook-metricas";

// Lógica do cron diário de "ciclo de vida" (src/app/api/cron/lifecycle/
// route.ts) — separada da rota pra poder ser testada sem precisar montar um
// NextRequest, mesmo padrão de src/lib/alerta-estoque.ts (lógica pura,
// chamada de dentro de uma rota/página fina).

const DIAS_AVISO_TRIAL = 2;

// --- E-mail de fim de trial -------------------------------------------

// Cron roda 1x/dia — a janela de 24h (entre DIAS_AVISO_TRIAL-1 e
// DIAS_AVISO_TRIAL dias a partir de agora) garante que toda gráfica em
// TRIALING passa pela janela exatamente uma vez, não importa a que hora do
// dia o trial dela expira. `avisoTrialEnviadoEm` (schema) é a trava de
// idempotência caso o cron rode mais de uma vez no mesmo dia por algum
// motivo (retry da Vercel, etc).
export async function enviarAvisosTrialExpirando(
  origemPublica: string
): Promise<{ avisosProcessados: number }> {
  const agora = new Date();
  const inicioJanela = new Date(agora.getTime() + (DIAS_AVISO_TRIAL - 1) * 24 * 60 * 60 * 1000);
  const fimJanela = new Date(agora.getTime() + DIAS_AVISO_TRIAL * 24 * 60 * 60 * 1000);

  const assinaturas = await prisma.assinaturaGrafica.findMany({
    where: {
      status: "TRIALING",
      avisoTrialEnviadoEm: null,
      trialExpiraEm: { gt: inicioJanela, lte: fimJanela },
    },
    select: { id: true, graficaId: true },
  });

  let avisosProcessados = 0;
  const linkAssinatura = `${origemPublica}/configuracoes/assinatura`;

  for (const assinatura of assinaturas) {
    const [donos, orcamentosGerados] = await Promise.all([
      prisma.usuario.findMany({
        where: { graficaId: assinatura.graficaId, papel: "DONO" },
        select: { email: true },
      }),
      // Contagem TOTAL de orçamentos da gráfica (não só do mês corrente,
      // diferente de calcularUsoAtual em src/lib/billing/uso.ts, que serve
      // ao propósito diferente de aplicar limite de plano). Aqui o objetivo
      // é reforçar o valor já recebido no trial inteiro, então "total desde
      // o cadastro" é o número mais persuasivo — e como o trial dura só
      // TRIAL_DIAS (14) dias, na prática quase sempre cabe dentro do mês
      // corrente mesmo, então as duas contagens raramente divergem muito.
      prisma.orcamento.count({ where: { graficaId: assinatura.graficaId } }),
    ]);

    // Marca a idempotência ANTES de disparar os e-mails: dispararEventoEmail
    // nunca lança (melhor esforço), então não existe um "tentar de novo
    // depois de falha real" pra esperar aqui — sem isso, uma gráfica sem
    // EMAIL_WEBHOOK_URL configurada (ou sem nenhum DONO, caso não devesse
    // acontecer) seria reprocessada todo dia pra sempre.
    await prisma.assinaturaGrafica.update({
      where: { id: assinatura.id },
      data: { avisoTrialEnviadoEm: agora },
    });
    avisosProcessados += 1;

    if (donos.length === 0) continue;

    const { assunto, html, texto } = templateTrialExpirando(orcamentosGerados, linkAssinatura);
    for (const dono of donos) {
      await dispararEventoEmail({ tipo: "trial_expirando", destinatario: dono.email, assunto, html, texto });
    }
  }

  return { avisosProcessados };
}

// --- Métricas agregadas pro n8n -----------------------------------------

// Neon free tier: ~0.5 GB de storage no banco. Alerta quando o uso passa de
// 80% disso — dá folga pro dono migrar de plano (Neon Launch) antes de
// bater no teto de verdade, que passa a rejeitar escrita. Ajuste esta
// constante se o plano do banco mudar.
const NEON_FREE_TIER_BYTES = 0.5 * 1024 ** 3;
const LIMITE_ALERTA_CAPACIDADE = 0.8;

export type MetricasAgregadas = {
  totalGraficas: number;
  totalUsuarios: number;
  usuariosAtivos: number;
  bancoTamanhoBytes: number;
  bancoPercentualUsado: number;
  alertaCapacidade: boolean;
};

async function coletarMetricasAgregadas(): Promise<MetricasAgregadas> {
  const agora = new Date();

  const [totalGraficas, totalUsuarios, usuariosAtivos, tamanhoBanco] = await Promise.all([
    prisma.grafica.count(),
    prisma.usuario.count(),
    // "Ativo" = tem ao menos uma sessão ainda não expirada — reflete quem
    // está de fato logado agora, não quem só existe no banco (mais fiel do
    // que, por ex, "usuário criado nos últimos N dias", que não diz nada
    // sobre uso de verdade).
    prisma.usuario.count({ where: { sessoes: { some: { expiraEm: { gt: agora } } } } }),
    prisma.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database()) AS bytes`,
  ]);

  const bancoTamanhoBytes = Number(tamanhoBanco[0]?.bytes ?? 0);
  const bancoPercentualUsado =
    Math.round((bancoTamanhoBytes / NEON_FREE_TIER_BYTES) * 1000) / 1000;

  return {
    totalGraficas,
    totalUsuarios,
    usuariosAtivos,
    bancoTamanhoBytes,
    bancoPercentualUsado,
    alertaCapacidade: bancoPercentualUsado >= LIMITE_ALERTA_CAPACIDADE,
  };
}

export async function enviarMetricasDiarias(): Promise<MetricasAgregadas> {
  const metricas = await coletarMetricasAgregadas();
  // Melhor esforço — nunca lança (ver dispararMetrica). Se METRICAS_WEBHOOK_URL
  // não estiver configurada, isso é só um no-op; o cron continua ok.
  await dispararMetrica({ tipo: "metricas_diarias", dados: metricas });
  return metricas;
}
