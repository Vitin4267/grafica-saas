"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { ESTAGIOS_ATRIBUIVEIS } from "@/lib/producao-estagios";
import { avancarStatusPedido } from "@/app/producao/status-transicao";
import { assinaturaEstaLiberada } from "@/lib/billing/status";

export type AvancarStatusQrResult = { ok: boolean; mensagem: string };

// Sem autenticação: o próprio token é o "credencial" — mesmo princípio de
// confirmarEstagioPublico (src/app/p/[token]/actions.ts), mas
// deliberadamente MAIS permissivo (ver comentário de Pedido.qrToken no
// schema): sem tentarRegistrarConfirmacaoEstagio (rate limit por IP não faz
// sentido pra um QR físico escaneado repetidas vezes pelo MESMO operador no
// chão de fábrica) e sem etapaEsperada (esse campo existe em p/[token] só
// pra travar um e-mail antigo reaberto dias depois — a etiqueta impressa
// não "expira" pra uma etapa específica, ela é reescaneada a cada etapa
// nova; o próprio CAS dentro de avancarStatusPedido, status ANTERIOR no
// where do updateMany, já cobre duplo toque/duas abas).
export async function avancarStatusQr(
  _estadoAnterior: AvancarStatusQrResult | null,
  formData: FormData
): Promise<AvancarStatusQrResult> {
  const token = String(formData.get("token"));

  const pedido = await prisma.pedido.findUnique({
    where: { qrToken: token },
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

  // Mesma checagem de assinatura de confirmarEstagioPublico — sem sessão de
  // usuário aqui, então busca a assinatura da gráfica DONA do pedido pelo
  // graficaId em vez de reaproveitar exigirAssinaturaAtiva.
  const assinatura = await prisma.assinaturaGrafica.findUnique({
    where: { graficaId: pedido.graficaId },
  });
  if (!assinaturaEstaLiberada(assinatura)) {
    return {
      ok: false,
      mensagem: "A assinatura desta gráfica não está ativa no momento — não é possível avançar por aqui.",
    };
  }

  // Só as etapas atribuíveis têm avanço de um clique só por aqui — mesma
  // regra de p/[token] (FILA fica de fora: baixa estoque e exige a tela de
  // confirmação de perda de material, que não existe nesta versão mobile;
  // ENTREGUE/CANCELADO são terminais).
  const confirmavel = ESTAGIOS_ATRIBUIVEIS.some((estagio) => estagio.valor === pedido.status);
  if (!confirmavel) {
    return { ok: false, mensagem: "Este pedido não tem nenhuma etapa pra avançar agora." };
  }

  const resultado = await avancarStatusPedido(pedido, null);
  if (!resultado.ok) {
    return { ok: false, mensagem: resultado.mensagem };
  }

  revalidatePath(`/q/${token}`);
  return { ok: true, mensagem: resultado.mensagem };
}
