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
import {
  ORDEM_SEGMENTO_GRAFICA,
  ROTULO_SEGMENTO_GRAFICA,
  ORDEM_TIPO_CHAVE_PIX,
  ROTULO_TIPO_CHAVE_PIX,
} from "@/lib/tipos-grafica";
import type { SegmentoGrafica, TipoChavePix } from "@/generated/prisma/enums";

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

export type SalvarSegmentoResult = { ok: boolean; mensagem: string };

// Achado A6 da Parte 6 da auditoria de abrangência — pergunta única e
// opcional sobre o perfil de negócio da gráfica (ver Grafica.segmento no
// schema). Mesma validação de validarSegmento em src/app/clientes/actions.ts:
// lista fechada, segmentoOutro só obrigatório quando segmento=OUTRO, campo
// em si sempre opcional (o Dono pode limpar de volta pra "Não informado").
export async function salvarSegmento(
  _estadoAnterior: SalvarSegmentoResult | null,
  formData: FormData
): Promise<SalvarSegmentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const segmentoBruto = String(formData.get("segmento") ?? "").trim();
  let segmento: SegmentoGrafica | null = null;
  let segmentoOutro: string | null = null;

  if (segmentoBruto) {
    if (!ORDEM_SEGMENTO_GRAFICA.includes(segmentoBruto as SegmentoGrafica)) {
      return { ok: false, mensagem: "Perfil de negócio inválido." };
    }
    segmento = segmentoBruto as SegmentoGrafica;
    if (segmento === "OUTRO") {
      segmentoOutro = String(formData.get("segmentoOutro") ?? "").trim();
      if (!segmentoOutro) {
        return { ok: false, mensagem: 'Descreva o perfil quando escolher "Outro".' };
      }
    }
  }

  const anterior = await prisma.grafica.findUniqueOrThrow({
    where: { id: usuario.graficaId },
    select: { segmento: true, segmentoOutro: true },
  });

  await prisma.grafica.update({
    where: { id: usuario.graficaId },
    data: { segmento, segmentoOutro },
  });

  if (anterior.segmento !== segmento || anterior.segmentoOutro !== segmentoOutro) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_segmento",
      entidade: "Grafica",
      entidadeId: usuario.graficaId,
      descricao: "Perfil de negócio da gráfica atualizado",
      valorAnterior: `Perfil: ${anterior.segmento ? ROTULO_SEGMENTO_GRAFICA[anterior.segmento] : "não informado"}`,
      valorNovo: `Perfil: ${segmento ? ROTULO_SEGMENTO_GRAFICA[segmento] : "não informado"}`,
    });
  }

  revalidatePath("/configuracoes/identidade");
  return { ok: true, mensagem: "Perfil de negócio salvo com sucesso!" };
}

export type SalvarDadosPagamentoResult = { ok: boolean; mensagem: string };

// Achado F6 da Parte 7 da auditoria de abrangência (pesquisa-abrangencia-
// modulos.md, 2026-08-31) — dados de RECEBIMENTO da própria gráfica
// (identidade comercial, não fiscal). SÓ EXIBIÇÃO: chavePix nunca é validada
// (texto livre, não confere CPF/CNPJ/e-mail real — mesmo espírito de
// dadosBancarios), nada aqui confirma pagamento automaticamente. Mesmo
// formato de salvarContato acima: vários campos texto livre opcionais num
// único form/action, só tipoChavePix tem lista fechada (mesma validação de
// salvarSegmento, mas sem campo-irmão "Outro" — ver comentário do enum
// TipoChavePix no schema).
export async function salvarDadosPagamento(
  _estadoAnterior: SalvarDadosPagamentoResult | null,
  formData: FormData
): Promise<SalvarDadosPagamentoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CONFIGURACOES"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar configurações." };
  }

  const chavePix = String(formData.get("chavePix") ?? "").trim() || null;
  const tipoChavePixBruto = String(formData.get("tipoChavePix") ?? "").trim();
  const favorecidoPix = String(formData.get("favorecidoPix") ?? "").trim() || null;
  const dadosBancarios = String(formData.get("dadosBancarios") ?? "").trim() || null;

  let tipoChavePix: TipoChavePix | null = null;
  if (tipoChavePixBruto) {
    if (!ORDEM_TIPO_CHAVE_PIX.includes(tipoChavePixBruto as TipoChavePix)) {
      return { ok: false, mensagem: "Tipo de chave PIX inválido." };
    }
    tipoChavePix = tipoChavePixBruto as TipoChavePix;
  }

  const anterior = await prisma.grafica.findUniqueOrThrow({
    where: { id: usuario.graficaId },
    select: { chavePix: true, tipoChavePix: true, favorecidoPix: true, dadosBancarios: true },
  });

  await prisma.grafica.update({
    where: { id: usuario.graficaId },
    data: { chavePix, tipoChavePix, favorecidoPix, dadosBancarios },
  });

  const mudou =
    anterior.chavePix !== chavePix ||
    anterior.tipoChavePix !== tipoChavePix ||
    anterior.favorecidoPix !== favorecidoPix ||
    anterior.dadosBancarios !== dadosBancarios;

  if (mudou) {
    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "configuracoes.salvar_dados_pagamento",
      entidade: "Grafica",
      entidadeId: usuario.graficaId,
      descricao: "Dados de recebimento (PIX) da gráfica atualizados",
      valorAnterior: `Tipo de chave: ${anterior.tipoChavePix ? ROTULO_TIPO_CHAVE_PIX[anterior.tipoChavePix] : "não informado"}`,
      valorNovo: `Tipo de chave: ${tipoChavePix ? ROTULO_TIPO_CHAVE_PIX[tipoChavePix] : "não informado"}`,
    });
  }

  revalidatePath("/configuracoes/identidade");
  return { ok: true, mensagem: "Dados de recebimento salvos com sucesso!" };
}
