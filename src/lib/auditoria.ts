import "server-only";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { obterIpRequisicao } from "@/lib/auth/ip";

type RegistrarAuditoriaInput = {
  graficaId: string;
  usuarioId: string;
  usuarioNome: string;
  acao: string;
  entidade: string;
  entidadeId: string;
  descricao: string;
  // O QUE mudou, não só que mudou (ver comentário do model LogAuditoria no
  // schema) — texto legível por humano, ex: "R$ 300,00", "Impressão →
  // Acabamento", "podeEditar: não → sim". NUNCA JSON cru: quem lê isto é o
  // dono da gráfica na tela de auditoria, não um programa. Omitido em ação
  // que não é edição (criar, excluir, aprovar).
  valorAnterior?: string;
  valorNovo?: string;
};

// Log de auditoria é melhor-esforço, nunca crítico: sempre chamado DEPOIS que
// a escrita principal da action já commitou (ver chamadores). Se o insert
// falhar (cold start do Neon, pool cheio) e essa exceção subisse, ela
// derrubaria a Server Action inteira depois que o dado real já foi salvo — o
// usuário veria um erro genérico, acharia que não salvou e tentaria de novo
// (em registrarPagamento isso duplica o pagamento). Por isso: nunca lança,
// só reporta (Sentry + console — mesmo padrão de src/lib/email/webhook-email.ts)
// e segue em frente.
export async function registrarAuditoria(dados: RegistrarAuditoriaInput): Promise<void> {
  // IP de quem fez a ação, preenchido aqui dentro pra nenhum chamador
  // precisar lembrar disso — ver comentário de obterIpRequisicao sobre por
  // que é o ÚLTIMO valor de X-Forwarded-For, não o primeiro. Se não der pra
  // resolver (fora do contexto de uma requisição, por exemplo), grava null
  // em vez de derrubar o log inteiro.
  let ip: string | null;
  try {
    ip = await obterIpRequisicao();
  } catch {
    ip = null;
  }

  try {
    await prisma.logAuditoria.create({ data: { ...dados, ip } });
  } catch (erro) {
    const contexto = { acao: dados.acao, entidade: dados.entidade, entidadeId: dados.entidadeId };
    Sentry.captureException(erro, { extra: contexto });
    // console.error sempre roda, mesmo sem SENTRY_DSN configurado (Sentry.*
    // é no-op nesse caso) — garante que a falha ao menos aparece nos logs da
    // Vercel, já que o insert em si não deixou nenhum rastro no banco.
    console.error("[auditoria] falha ao registrar log", contexto, erro);
  }
}
