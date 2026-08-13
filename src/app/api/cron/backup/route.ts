import { NextRequest } from "next/server";
import { put, list, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { cronAutorizado } from "@/lib/auth/cron";

// Camada EXTRA de backup, não a principal — a defesa real contra perda de
// dados é o PITR do próprio Neon (recomendado fazer upgrade de plano pro
// Launch, que dá 7 dias; o free tier só dá 6 HORAS, ver
// scripts/backup-db.sh). Isto aqui é um dump diário via Vercel Cron
// (vercel.json) pra sobrevivência básica mesmo sem esse upgrade — não
// substitui um PITR de verdade baseado em WAL.
//
// Não usa pg_dump (não existe binário disponível em runtime serverless) —
// exporta em JSON as tabelas de negócio via Prisma. Deliberadamente NÃO
// inclui tabelas de sessão/log/segurança (Sessao, LogAuditoria,
// TentativaLogin, tokens de reset/verificação) — não fazem parte do que
// precisa ser restaurado num desastre, e alguns são segredos com prazo de
// validade curto, sem motivo pra persistir num blob.
const RETENCAO_DIAS = 14;

async function exportarDados() {
  const [
    graficas,
    usuarios,
    clientes,
    itensCatalogo,
    itensGrafica,
    prensas,
    filiais,
    parametrosGrafica,
    dadosFiscais,
    automacao,
    orcamentos,
    orcamentoItens,
    pedidos,
    movimentacoesEstoque,
    despesas,
    pagamentos,
    comissoes,
    notasFiscais,
    assinaturas,
  ] = await Promise.all([
    prisma.grafica.findMany(),
    prisma.usuario.findMany(),
    prisma.cliente.findMany(),
    prisma.itemCatalogo.findMany(),
    prisma.itemGrafica.findMany(),
    prisma.prensa.findMany(),
    prisma.filial.findMany(),
    prisma.parametrosGrafica.findMany(),
    prisma.dadosFiscaisGrafica.findMany(),
    prisma.automacaoGrafica.findMany(),
    prisma.orcamento.findMany(),
    prisma.orcamentoItem.findMany(),
    prisma.pedido.findMany(),
    prisma.movimentacaoEstoque.findMany(),
    prisma.despesa.findMany(),
    prisma.pagamento.findMany(),
    prisma.comissao.findMany(),
    prisma.notaFiscal.findMany(),
    prisma.assinaturaGrafica.findMany(),
  ]);

  return {
    geradoEm: new Date().toISOString(),
    graficas,
    usuarios,
    clientes,
    itensCatalogo,
    itensGrafica,
    prensas,
    filiais,
    parametrosGrafica,
    dadosFiscais,
    automacao,
    orcamentos,
    orcamentoItens,
    pedidos,
    movimentacoesEstoque,
    despesas,
    pagamentos,
    comissoes,
    notasFiscais,
    assinaturas,
  };
}

async function limparBackupsAntigos() {
  const { blobs } = await list({ prefix: "backups/", token: process.env.BLOB_PRIVATE_READ_WRITE_TOKEN });
  const limite = Date.now() - RETENCAO_DIAS * 24 * 60 * 60 * 1000;
  const antigos = blobs.filter((b) => new Date(b.uploadedAt).getTime() < limite);
  await Promise.all(antigos.map((b) => del(b.url, { token: process.env.BLOB_PRIVATE_READ_WRITE_TOKEN })));
  return antigos.length;
}

export async function GET(request: NextRequest) {
  // Padrão Vercel Cron: só a própria infra da Vercel (ou quem souber o
  // segredo) consegue disparar — sem isso, a URL do endpoint sozinha já
  // seria suficiente pra qualquer um forçar um backup (dump completo de
  // TODAS as tabelas de TODOS os tenants a cada chamada, caro no Neon e no
  // Blob). Ver src/lib/auth/cron.ts pro porquê de não comparar direto.
  if (!cronAutorizado(request.headers.get("authorization"))) {
    return new Response("Unauthorized", { status: 401 });
  }

  const dados = await exportarDados();
  const nomeArquivo = `backups/backup-${new Date().toISOString().slice(0, 10)}.json`;

  // access: "private" — este dump inclui Usuario.senhaHash (hash argon2id de
  // todo usuário de toda gráfica) e DadosFiscaisGrafica.focusNfeToken (token
  // de API de terceiro em texto claro). Blob público + nome de arquivo
  // previsível == esses dados baixáveis por qualquer um que descubra a URL do
  // blob store, sem autenticação nenhuma. Restaurar exige usar `get()` de
  // @vercel/blob (autenticado pelo token do servidor), nunca a URL direta.
  // Store PRIVADO dedicado (BLOB_PRIVATE_READ_WRITE_TOKEN) — mesmo store da
  // imagem de tinta, público/privado é fixo por store no Vercel Blob.
  const blob = await put(nomeArquivo, JSON.stringify(dados), {
    access: "private",
    addRandomSuffix: true,
    contentType: "application/json",
    token: process.env.BLOB_PRIVATE_READ_WRITE_TOKEN,
  });

  const removidos = await limparBackupsAntigos();

  return Response.json({
    ok: true,
    arquivo: blob.url,
    tabelas: Object.keys(dados).length - 1,
    backupsAntigosRemovidos: removidos,
  });
}
