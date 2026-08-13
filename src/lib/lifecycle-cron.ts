import "server-only";
import { list, del, head } from "@vercel/blob";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { dispararEventoEmail } from "@/lib/email/webhook-email";
import { templateTrialExpirando } from "@/lib/email/templates";
import { dispararMetrica } from "@/lib/webhook-metricas";
import {
  diferencaReconciliacao,
  type LinhaRazao,
  type BlobReal,
  type DiferencaReconciliacao,
} from "@/lib/billing/reconciliacao-armazenamento";

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
      // after() em vez de await: dispararEventoEmail é melhor esforço
      // (nunca lança) e o resultado nunca é usado depois — não precisa
      // bloquear o loop/a resposta do cron. after() funciona em Route
      // Handlers (não só Server Actions/Components) — confirmado em
      // node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md
      // ("It can be used in ... Route Handlers"). Esta função roda dentro
      // do GET de src/app/api/cron/lifecycle/route.ts; o AsyncLocalStorage
      // que o after() usa por baixo dos panos propaga através da cadeia de
      // await normal, então chamar after() aqui — mesmo fora do arquivo da
      // rota — ainda está dentro do escopo da mesma requisição.
      after(() => dispararEventoEmail({ tipo: "trial_expirando", destinatario: dono.email, assunto, html, texto }));
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

// --- Reconciliação da cota de armazenamento ------------------------------

// Tamanho do lote de query+head() em paralelo no backfill abaixo — grande o
// bastante pra não estourar maxDuration (ver src/app/api/cron/lifecycle/
// route.ts) conforme a base cresce, pequeno o bastante pra não disparar rate
// limit/excesso de conexão simultânea contra o Blob e o Postgres.
const TAMANHO_LOTE_BACKFILL = 10;

async function emLotes<T>(itens: T[], tamanhoLote: number, tarefa: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < itens.length; i += tamanhoLote) {
    await Promise.all(itens.slice(i, i + tamanhoLote).map(tarefa));
  }
}

// Preenche o razão (ArquivoArmazenado) pra arte/logo que já existiam ANTES
// desta feature — sem isso, todo arquivo enviado antes de hoje seria
// classificado como "órfão" pela etapa de limpeza abaixo. Idempotente: só
// cria linha pra quem ainda não tem uma.
//
// Query + head() de rede POR LINHA, em lotes de TAMANHO_LOTE_BACKFILL em vez
// de sequencial — com a base crescendo (centenas de pedidos), um `for`
// totalmente sequencial passa de maxDuration e mata o cron no meio,
// derrubando junto as outras tarefas do mesmo Promise.all em route.ts.
async function backfillArquivosLegados(): Promise<void> {
  const [pedidosComArte, graficasComLogo] = await Promise.all([
    prisma.pedido.findMany({
      where: { arteUrl: { not: null } },
      select: { id: true, graficaId: true, arteUrl: true },
    }),
    prisma.grafica.findMany({
      where: { logoUrl: { not: null } },
      select: { id: true, logoUrl: true },
    }),
  ]);

  await emLotes(pedidosComArte, TAMANHO_LOTE_BACKFILL, async (pedido) => {
    const jaTemLinha = await prisma.arquivoArmazenado.findFirst({
      where: { tipo: "ARTE_PEDIDO", referenciaId: pedido.id },
    });
    if (jaTemLinha) return;
    const info = await head(pedido.arteUrl!).catch(() => null);
    if (!info) return; // blob já não existe mais — nada a preencher
    await prisma.arquivoArmazenado.create({
      data: {
        graficaId: pedido.graficaId,
        tipo: "ARTE_PEDIDO",
        referenciaId: pedido.id,
        bytes: info.size,
        url: info.url,
        pathname: info.pathname,
      },
    });
  });

  await emLotes(graficasComLogo, TAMANHO_LOTE_BACKFILL, async (grafica) => {
    const jaTemLinha = await prisma.arquivoArmazenado.findFirst({
      where: { tipo: "LOGO_GRAFICA", referenciaId: grafica.id },
    });
    if (jaTemLinha) return;
    const info = await head(grafica.logoUrl!).catch(() => null);
    if (!info) return;
    await prisma.arquivoArmazenado.create({
      data: {
        graficaId: grafica.id,
        tipo: "LOGO_GRAFICA",
        referenciaId: grafica.id,
        bytes: info.size,
        url: info.url,
        pathname: info.pathname,
      },
    });
  });
}

export type ResultadoReconciliacaoArmazenamento = {
  reservasExpiradas: number;
  bytesCorrigidos: number;
  linhasRemovidasDoRazao: number;
  orfaosEncontrados: number;
  orfaosApagados: number;
};

// Lista TODOS os blobs de UM store (paginado) — usado uma vez por store, ver
// reconciliarArmazenamento abaixo. `token` undefined = store público padrão
// (BLOB_READ_WRITE_TOKEN); passe BLOB_PRIVATE_READ_WRITE_TOKEN pro privado.
async function listarTodosOsBlobs(token: string | undefined): Promise<BlobReal[]> {
  const blobs: BlobReal[] = [];
  let cursor: string | undefined;
  do {
    const pagina = await list({ cursor, limit: 1000, token });
    blobs.push(
      ...pagina.blobs.map((b) => ({ url: b.url, pathname: b.pathname, size: b.size, uploadedAt: b.uploadedAt }))
    );
    cursor = pagina.hasMore ? pagina.cursor : undefined;
  } while (cursor);
  return blobs;
}

const DIFERENCA_VAZIA: DiferencaReconciliacao = {
  reservasExpiradas: [],
  paraCorrigirBytes: [],
  paraRemoverDoRazao: [],
  orfaosParaApagar: [],
};

// Tipos de ArquivoArmazenado que vivem no store PÚBLICO — o resto
// (ANALISE_TINTA) vive no store PRIVADO. Usado só pra separar a linha do
// razão pro lado certo antes de comparar contra os blobs de cada store (ver
// comentário de reconciliarArmazenamento).
const TIPOS_STORE_PUBLICO = new Set(["ARTE_PEDIDO", "LOGO_GRAFICA"]);

// Rede de segurança da cota de armazenamento (ver src/lib/billing/armazenamento.ts
// e o comentário do model ArquivoArmazenado no schema): corrige o razão pra
// bater com a verdade do Blob, e opcionalmente apaga arquivo órfão (upload
// cujo registro nunca existiu/foi perdido — a mesma classe de bug que o
// del() ausente já causou uma vez neste projeto, ver comentário em
// enviarArte). A etapa de apagar é destrutiva, então fica atrás de uma env
// var desligada por padrão — rode uma vez só CONTANDO antes de ligar.
//
// DOIS stores (público pra arte/logo, privado pra tinta/backup — acesso é
// fixo por store no Vercel Blob, não dá pra misturar) — por isso rodam em
// DUAS passadas independentes (ver comentário abaixo), nunca misturadas
// numa lista só. tokenPorUrl guarda de qual store cada blob veio, pra
// del(orfao) usar o token certo lá embaixo.
export async function reconciliarArmazenamento(): Promise<ResultadoReconciliacaoArmazenamento> {
  await backfillArquivosLegados();

  const linhasRazao = await prisma.arquivoArmazenado.findMany({
    select: { id: true, url: true, bytes: true, createdAt: true, tipo: true },
  });
  const linhasPublicas: LinhaRazao[] = linhasRazao.filter((l) => TIPOS_STORE_PUBLICO.has(l.tipo));
  const linhasPrivadas: LinhaRazao[] = linhasRazao.filter((l) => !TIPOS_STORE_PUBLICO.has(l.tipo));

  // Duas passadas INDEPENDENTES, uma por store — nunca junta os blobs dos
  // dois numa lista só. O lado público sempre roda. O lado privado só roda
  // se BLOB_PRIVATE_READ_WRITE_TOKEN existir: sem a env var, "não consigo
  // checar o store privado agora" é bem diferente de "nenhum blob privado
  // existe" — tratar como o segundo (ex: blobsPrivados = []) faria TODA
  // linha ANALISE_TINTA do razão parecer órfã e ser apagada do banco de
  // verdade, mesmo que o arquivo continue vivo no Blob. Pular a passada
  // inteira evita isso: nenhuma linha ANALISE_TINTA é tocada na rodada em
  // que o token está ausente.
  const tokenPorUrl = new Map<string, string | undefined>();

  const blobsPublicos = await listarTodosOsBlobs(undefined);
  for (const b of blobsPublicos) tokenPorUrl.set(b.url, undefined);
  const diferencaPublica = diferencaReconciliacao(linhasPublicas, blobsPublicos);

  let diferencaPrivada = DIFERENCA_VAZIA;
  const tokenPrivado = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  if (tokenPrivado) {
    const blobsPrivados = await listarTodosOsBlobs(tokenPrivado);
    for (const b of blobsPrivados) tokenPorUrl.set(b.url, tokenPrivado);
    diferencaPrivada = diferencaReconciliacao(linhasPrivadas, blobsPrivados);
  }

  const reservasExpiradas = [...diferencaPublica.reservasExpiradas, ...diferencaPrivada.reservasExpiradas];
  const paraCorrigirBytes = [...diferencaPublica.paraCorrigirBytes, ...diferencaPrivada.paraCorrigirBytes];
  const paraRemoverDoRazao = [...diferencaPublica.paraRemoverDoRazao, ...diferencaPrivada.paraRemoverDoRazao];
  const orfaosParaApagar = [...diferencaPublica.orfaosParaApagar, ...diferencaPrivada.orfaosParaApagar];

  if (reservasExpiradas.length > 0) {
    await prisma.arquivoArmazenado.deleteMany({ where: { id: { in: reservasExpiradas } } });
  }
  for (const item of paraCorrigirBytes) {
    await prisma.arquivoArmazenado.update({ where: { id: item.id }, data: { bytes: item.bytesCorreto } });
  }
  if (paraRemoverDoRazao.length > 0) {
    await prisma.arquivoArmazenado.deleteMany({ where: { id: { in: paraRemoverDoRazao } } });
  }

  let orfaosApagados = 0;
  // Desligado por padrão de propósito (ver comentário da função) — com a
  // env var ausente/diferente de "1", esta etapa só CONTA, nunca apaga.
  if (process.env.ARMAZENAMENTO_LIMPEZA_ORFAOS === "1") {
    for (const orfao of orfaosParaApagar) {
      await del(orfao.url, { token: tokenPorUrl.get(orfao.url) }).catch(() => {});
      orfaosApagados++;
    }
  }

  return {
    reservasExpiradas: reservasExpiradas.length,
    bytesCorrigidos: paraCorrigirBytes.length,
    linhasRemovidasDoRazao: paraRemoverDoRazao.length,
    orfaosEncontrados: orfaosParaApagar.length,
    orfaosApagados,
  };
}
