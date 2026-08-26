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

// Helper genérico de diff campo-a-campo — extraído do padrão que
// salvarParametros (src/app/configuracoes/actions.ts) já usava manualmente
// (monta antesTextos/depoisTextos, só loga o que realmente mudou), pra não
// reescrever o mesmo bloco em cada actions.ts novo de Configurações (achado
// A3 da auditoria de abrangência, 2026-08-24: 12 das 14 telas do módulo não
// deixavam rastro nenhum). Deliberadamente NÃO usado dentro de
// salvarParametros em si — aquela action já está em produção e testada, e o
// risco de um refactor ali não compensa o ganho de não duplicar ~15 linhas.
// Comparação é sempre `!==` estrito: "" e null contam como valores
// diferentes de propósito, então normalize antes de chamar `campo()` se o
// seu campo deve tratar os dois como iguais.
export function criarDiffCampos() {
  const antesTextos: string[] = [];
  const depoisTextos: string[] = [];
  return {
    campo(
      rotulo: string,
      antes: string | number | boolean | null,
      depois: string | number | boolean | null,
      formatar?: (valor: string | number | boolean) => string
    ) {
      if (antes === depois) return;
      const exibir = (valor: string | number | boolean | null) =>
        valor === null ? "—" : formatar ? formatar(valor) : String(valor);
      antesTextos.push(`${rotulo}: ${exibir(antes)}`);
      depoisTextos.push(`${rotulo}: ${exibir(depois)}`);
    },
    get temMudanca(): boolean {
      return antesTextos.length > 0;
    },
    antesTextos,
    depoisTextos,
  };
}

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
