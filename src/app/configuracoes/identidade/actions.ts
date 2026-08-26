"use server";

import { revalidatePath } from "next/cache";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import {
  validarArquivoLogo,
  extensaoLogo,
  assinaturaBateComTipo,
  BYTES_ASSINATURA,
} from "@/lib/upload-validacao";
import {
  resolverContextoArmazenamento,
  reservarEspaco,
  confirmarArquivo,
  cancelarReserva,
  removerArquivo,
} from "@/lib/billing/armazenamento";
import { registrarAuditoria } from "@/lib/auditoria";

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
  // Confere a assinatura real do arquivo, não só o Content-Type declarado
  // pelo cliente (forjável) — ver comentário em upload-validacao.ts.
  const cabecalho = new Uint8Array(await arquivo.slice(0, BYTES_ASSINATURA).arrayBuffer());
  if (!assinaturaBateComTipo(cabecalho, arquivo.type)) {
    return { ok: false, mensagem: "O conteúdo do arquivo não corresponde a uma imagem PNG, JPG ou WEBP." };
  }

  const { logoUrl: logoAnterior } = await prisma.grafica.findUniqueOrThrow({
    where: { id: usuario.graficaId },
    select: { logoUrl: true },
  });

  // Reserva o espaço ANTES do put() — ver src/lib/billing/armazenamento.ts.
  const contextoArmazenamento = resolverContextoArmazenamento(usuario);
  const reserva = await reservarEspaco({
    graficaId: usuario.graficaId,
    tipo: "LOGO_GRAFICA",
    referenciaId: usuario.graficaId,
    bytes: arquivo.size,
    contexto: contextoArmazenamento,
  });
  if (!reserva.ok) {
    return { ok: false, mensagem: reserva.mensagem };
  }

  const extensao = extensaoLogo(arquivo.type);
  // access: "public" — logo é material de marca da própria gráfica, sem
  // segredo nenhum, e precisa ser visível sem autenticação tanto no PDF
  // (fetch server-side) quanto em qualquer tela pública que venha a mostrá-la.
  let blob;
  try {
    blob = await put(`logos/${usuario.graficaId}/${Date.now()}.${extensao}`, arquivo, {
      access: "public",
      addRandomSuffix: true,
      contentType: arquivo.type,
    });
  } catch (erro) {
    await cancelarReserva(reserva.arquivoId);
    // console.error sempre roda, mesmo sem SENTRY_DSN configurado (ver
    // src/lib/auditoria.ts) — mesmo cuidado de enviarArte (producao/actions.ts).
    console.error("[salvarLogo] falha ao subir arquivo no Vercel Blob", { graficaId: usuario.graficaId }, erro);
    return {
      ok: false,
      mensagem: "Não foi possível enviar o arquivo agora. Tente de novo em instantes.",
    };
  }
  await confirmarArquivo(reserva.arquivoId, { url: blob.url, pathname: blob.pathname });

  await prisma.grafica.update({
    where: { id: usuario.graficaId },
    data: { logoUrl: blob.url },
  });

  // Melhor esforço: apaga a logo antiga do Blob depois que a nova já está
  // salva no banco — nunca deixa a gráfica sem logo se o del() falhar.
  if (logoAnterior) {
    await del(logoAnterior).catch(() => {});
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "configuracoes.salvar_logo",
    entidade: "Grafica",
    entidadeId: usuario.graficaId,
    descricao: logoAnterior ? "Logo da gráfica substituída" : "Logo da gráfica enviada",
  });

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

  const arquivoRemovido = await removerArquivo({
    graficaId: usuario.graficaId,
    tipo: "LOGO_GRAFICA",
    referenciaId: usuario.graficaId,
  });
  if (arquivoRemovido) {
    await del(arquivoRemovido.url).catch(() => {});
  } else if (logoAnterior) {
    // Fallback pra logo enviada antes desta feature existir (sem linha no
    // razão) — ainda precisa apagar o arquivo do Blob.
    await del(logoAnterior).catch(() => {});
  }

  if (logoAnterior) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.remover_logo",
      entidade: "Grafica",
      entidadeId: usuario.graficaId,
      descricao: "Logo da gráfica removida",
    });
  }

  revalidatePath("/configuracoes/identidade");
  return { ok: true, mensagem: "Logo removida." };
}

export type SalvarCorResult = { ok: boolean; mensagem: string };

// Mesmo formato que src/lib/email/templates.ts e src/lib/pdf/OrcamentoDocumento.tsx
// exigem de Grafica.corPrimaria antes de confiar nela dentro de um `style`
// de e-mail/PDF — validado aqui ANTES de salvar (defesa em profundidade: os
// dois consumidores validam de novo na leitura, mas salvar algo fora do
// formato já seria um dado corrompido no banco à toa).
const HEX_REGEX_COR = /^#[0-9A-Fa-f]{6}$/;

export async function salvarCorPrimaria(
  _estadoAnterior: SalvarCorResult | null,
  formData: FormData
): Promise<SalvarCorResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const cor = String(formData.get("corPrimaria") ?? "").trim();
  if (!HEX_REGEX_COR.test(cor)) {
    return {
      ok: false,
      mensagem: "Cor inválida — use o formato hexadecimal #RRGGBB (ex: #0d9488).",
    };
  }

  const { corPrimaria: corAnterior } = await prisma.grafica.findUniqueOrThrow({
    where: { id: usuario.graficaId },
    select: { corPrimaria: true },
  });

  await prisma.grafica.update({
    where: { id: usuario.graficaId },
    data: { corPrimaria: cor },
  });

  if (corAnterior !== cor) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_cor_primaria",
      entidade: "Grafica",
      entidadeId: usuario.graficaId,
      descricao: "Cor primária da gráfica atualizada",
      valorAnterior: `Cor primária: ${corAnterior ?? "padrão"}`,
      valorNovo: `Cor primária: ${cor}`,
    });
  }

  revalidatePath("/configuracoes/identidade");
  return { ok: true, mensagem: "Cor salva com sucesso!" };
}

export async function restaurarCorPadrao(
  _estadoAnterior: SalvarCorResult | null,
  _formData: FormData
): Promise<SalvarCorResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const { corPrimaria: corAnterior } = await prisma.grafica.findUniqueOrThrow({
    where: { id: usuario.graficaId },
    select: { corPrimaria: true },
  });

  await prisma.grafica.update({
    where: { id: usuario.graficaId },
    data: { corPrimaria: null },
  });

  if (corAnterior !== null) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.restaurar_cor_padrao",
      entidade: "Grafica",
      entidadeId: usuario.graficaId,
      descricao: "Cor primária da gráfica restaurada pro padrão",
      valorAnterior: `Cor primária: ${corAnterior}`,
      valorNovo: "Cor primária: padrão",
    });
  }

  revalidatePath("/configuracoes/identidade");
  return { ok: true, mensagem: "Cor padrão restaurada." };
}

export type SalvarContatoResult = { ok: boolean; mensagem: string };

export async function salvarContato(
  _estadoAnterior: SalvarContatoResult | null,
  formData: FormData
): Promise<SalvarContatoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const telefone = String(formData.get("telefone") ?? "").trim() || null;
  const emailContato = String(formData.get("emailContato") ?? "").trim() || null;
  const site = String(formData.get("site") ?? "").trim() || null;
  const enderecoResumido = String(formData.get("enderecoResumido") ?? "").trim() || null;

  // Validação leve de e-mail se fornecido
  if (emailContato && !emailContato.includes("@")) {
    return {
      ok: false,
      mensagem: "E-mail inválido.",
    };
  }

  const contatoAnterior = await prisma.grafica.findUniqueOrThrow({
    where: { id: usuario.graficaId },
    select: { telefone: true, emailContato: true, site: true, enderecoResumido: true },
  });

  await prisma.grafica.update({
    where: { id: usuario.graficaId },
    data: { telefone, emailContato, site, enderecoResumido },
  });

  // Registra auditoria apenas se algo realmente mudou
  const mudou =
    contatoAnterior.telefone !== telefone ||
    contatoAnterior.emailContato !== emailContato ||
    contatoAnterior.site !== site ||
    contatoAnterior.enderecoResumido !== enderecoResumido;

  if (mudou) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_dados_contato",
      entidade: "Grafica",
      entidadeId: usuario.graficaId,
      descricao: "Dados de contato da gráfica atualizados",
    });
  }

  revalidatePath("/configuracoes/identidade");
  return { ok: true, mensagem: "Dados de contato salvos com sucesso!" };
}
