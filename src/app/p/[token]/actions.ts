"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { obterIpRequisicao } from "@/lib/auth/ip";
import { tentarRegistrarConfirmacaoEstagio } from "@/lib/auth/rate-limit";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";
import { ESTAGIOS_ATRIBUIVEIS, ROTULOS_STATUS_PEDIDO } from "@/lib/producao-estagios";
import { avancarStatusPedido } from "@/app/producao/status-transicao";
import { assinaturaEstaLiberada } from "@/lib/billing/status";

export type ConfirmarEstagioResult = { ok: boolean; mensagem: string };

// Sem autenticação: o próprio token é o "credencial" — mesmo padrão de
// responderArtePublica (src/app/a/[token]/actions.ts). Não precisa de CAS
// extra no nível do token: o CAS já dentro de avancarStatusPedido (status
// ANTERIOR no where do updateMany) cobre a corrida entre um clique no
// e-mail e uma confirmação simultânea em app.
export async function confirmarEstagioPublico(
  _estadoAnterior: ConfirmarEstagioResult | null,
  formData: FormData
): Promise<ConfirmarEstagioResult> {
  const token = String(formData.get("token"));

  const pedido = await prisma.pedido.findUnique({
    where: { producaoLinkToken: token },
    include: {
      orcamento: {
        include: {
          cliente: true,
          grafica: true,
          itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
        },
      },
    },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }

  // Sem sessão de usuário aqui, então não dá pra reaproveitar
  // exigirAssinaturaAtiva (que espera usuario.grafica.assinatura já
  // carregado e redireciona pra /configuracoes/assinatura — não faz
  // sentido pra quem nem tem login). Busca a assinatura da gráfica DONA do
  // pedido pelo graficaId e aplica a mesma regra de liberação
  // (assinaturaEstaLiberada), só que devolvendo um erro amigável em vez de
  // redirecionar. Sem checagem de limite de uso (calcularUsoAtual) — isso
  // é sobre criar recursos novos, não sobre confirmar uma etapa de um
  // pedido que já existe.
  const assinatura = await prisma.assinaturaGrafica.findUnique({
    where: { graficaId: pedido.graficaId },
  });
  if (!assinaturaEstaLiberada(assinatura)) {
    return {
      ok: false,
      mensagem: "A assinatura desta gráfica não está ativa no momento — não é possível confirmar por aqui.",
    };
  }

  // Trava contra e-mail antigo: o campo etapaEsperada vem preenchido por
  // page.tsx com o status do pedido no momento em que a página foi
  // renderizada (mesmo status que o link daquele e-mail específico
  // anunciava). Se o pedido já avançou (ou regrediu) desde então, o clique
  // veio de uma aba/e-mail desatualizado — rejeita em vez de confirmar a
  // partir do status ATUAL, que pode não ser o que a pessoa pensa que está
  // confirmando (no limite, cliques sequenciais em links antigos poderiam
  // empurrar o pedido até ENTREGUE, que é irreversível).
  const etapaEsperada = String(formData.get("etapaEsperada"));
  if (pedido.status !== etapaEsperada) {
    return {
      ok: false,
      mensagem: `Esse link não é mais válido pra etapa atual do pedido (agora está em ${ROTULOS_STATUS_PEDIDO[pedido.status]}) — peça um link novo ou confirme direto no site.`,
    };
  }

  // Só as etapas atribuíveis podem ser confirmadas por aqui — mesma regra
  // de page.tsx (evita confirmar FILA sem a tela de perda de material, e
  // ENTREGUE/CANCELADO não têm o que confirmar).
  const confirmavel = ESTAGIOS_ATRIBUIVEIS.some((estagio) => estagio.valor === pedido.status);
  if (!confirmavel) {
    return { ok: false, mensagem: "Este pedido não tem nenhuma etapa pra confirmar agora." };
  }

  const ip = await obterIpRequisicao();
  let bloqueado: boolean;
  try {
    bloqueado = await tentarRegistrarConfirmacaoEstagio(pedido.id, ip);
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      bloqueado = true;
    } else {
      throw erro;
    }
  }
  if (bloqueado) {
    return { ok: false, mensagem: "Muitas tentativas — aguarde alguns minutos e tente de novo." };
  }

  const resultado = await avancarStatusPedido(pedido, null);
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  revalidatePath(`/p/${token}`);
  return { ok: true, mensagem: resultado.mensagem };
}
