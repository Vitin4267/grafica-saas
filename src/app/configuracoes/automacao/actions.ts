"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { validarWebhookUrl } from "@/lib/webhook-assistente";

export type SalvarAutomacaoResult = { ok: boolean; mensagem: string };

export async function salvarAutomacao(
  _estadoAnterior: SalvarAutomacaoResult | null,
  formData: FormData
): Promise<SalvarAutomacaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  // Campo write-only: em branco = "manter o valor salvo" (nunca reexibimos a
  // URL completa no formulário, só o domínio — ver page.tsx).
  const novaUrl = formData.get("webhookUrl");
  let webhookUrlParaSalvar: string | undefined;
  if (typeof novaUrl === "string" && novaUrl.trim()) {
    const validacao = validarWebhookUrl(novaUrl.trim());
    if (!validacao.ok) {
      return { ok: false, mensagem: validacao.mensagem ?? "URL inválida." };
    }
    webhookUrlParaSalvar = novaUrl.trim();
  }

  // Checkbox desmarcado não aparece no FormData — ausência = false.
  const notificarStatusMudou = formData.get("notificarStatusMudou") === "on";
  const notificarEstoqueCritico = formData.get("notificarEstoqueCritico") === "on";
  const notificarPedidoAtrasado = formData.get("notificarPedidoAtrasado") === "on";

  await prisma.automacaoGrafica.upsert({
    where: { graficaId: usuario.graficaId },
    update: {
      ...(webhookUrlParaSalvar !== undefined ? { webhookUrl: webhookUrlParaSalvar } : {}),
      notificarStatusMudou,
      notificarEstoqueCritico,
      notificarPedidoAtrasado,
    },
    create: {
      graficaId: usuario.graficaId,
      ...(webhookUrlParaSalvar !== undefined ? { webhookUrl: webhookUrlParaSalvar } : {}),
      notificarStatusMudou,
      notificarEstoqueCritico,
      notificarPedidoAtrasado,
    },
  });

  revalidatePath("/configuracoes/automacao");
  return { ok: true, mensagem: "Automação salva com sucesso!" };
}
