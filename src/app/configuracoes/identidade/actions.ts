"use server";

import { revalidatePath } from "next/cache";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { validarArquivoLogo, extensaoLogo } from "@/lib/upload-validacao";

export type SalvarLogoResult = { ok: boolean; mensagem: string };

export async function salvarLogo(
  _estadoAnterior: SalvarLogoResult | null,
  formData: FormData
): Promise<SalvarLogoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File)) {
    return { ok: false, mensagem: "Selecione uma imagem." };
  }
  const validacao = validarArquivoLogo(arquivo);
  if (!validacao.ok) {
    return { ok: false, mensagem: validacao.mensagem };
  }

  const { logoUrl: logoAnterior } = await prisma.grafica.findUniqueOrThrow({
    where: { id: usuario.graficaId },
    select: { logoUrl: true },
  });

  const extensao = extensaoLogo(arquivo.type);
  // access: "public" — logo é material de marca da própria gráfica, sem
  // segredo nenhum, e precisa ser visível sem autenticação tanto no PDF
  // (fetch server-side) quanto em qualquer tela pública que venha a mostrá-la.
  const blob = await put(`logos/${usuario.graficaId}-${Date.now()}.${extensao}`, arquivo, {
    access: "public",
    addRandomSuffix: true,
    contentType: arquivo.type,
  });

  await prisma.grafica.update({
    where: { id: usuario.graficaId },
    data: { logoUrl: blob.url },
  });

  // Melhor esforço: apaga a logo antiga do Blob depois que a nova já está
  // salva no banco — nunca deixa a gráfica sem logo se o del() falhar.
  if (logoAnterior) {
    await del(logoAnterior).catch(() => {});
  }

  revalidatePath("/configuracoes/identidade");
  return { ok: true, mensagem: "Logo salva com sucesso!" };
}

export async function removerLogo(
  _estadoAnterior: SalvarLogoResult | null,
  _formData: FormData
): Promise<SalvarLogoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const { logoUrl: logoAnterior } = await prisma.grafica.findUniqueOrThrow({
    where: { id: usuario.graficaId },
    select: { logoUrl: true },
  });

  await prisma.grafica.update({
    where: { id: usuario.graficaId },
    data: { logoUrl: null },
  });

  if (logoAnterior) {
    await del(logoAnterior).catch(() => {});
  }

  revalidatePath("/configuracoes/identidade");
  return { ok: true, mensagem: "Logo removida." };
}
