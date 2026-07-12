"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { validarWebhookUrl } from "@/lib/webhook-assistente";

export type SalvarAssistenteResult = { ok: boolean; mensagem: string };

export async function salvarAssistente(
  _estadoAnterior: SalvarAssistenteResult | null,
  formData: FormData
): Promise<SalvarAssistenteResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  // Campo write-only: em branco = "manter o valor salvo" (nunca reexibimos a
  // URL completa no formulário, só o domínio — ver page.tsx).
  const novaUrl = formData.get("webhookUrl");
  if (typeof novaUrl === "string" && novaUrl.trim()) {
    const validacao = validarWebhookUrl(novaUrl.trim());
    if (!validacao.ok) {
      return { ok: false, mensagem: validacao.mensagem ?? "URL inválida." };
    }

    await prisma.assistenteGrafica.upsert({
      where: { graficaId: usuario.graficaId },
      update: { webhookUrl: novaUrl.trim() },
      create: { graficaId: usuario.graficaId, webhookUrl: novaUrl.trim() },
    });
  }

  revalidatePath("/configuracoes/assistente");
  return { ok: true, mensagem: "Assistente salvo com sucesso!" };
}
