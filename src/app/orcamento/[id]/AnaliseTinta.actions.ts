"use server";

import { revalidatePath } from "next/cache";
import { put, del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { verificarRecursoPago } from "@/lib/auth/recurso-pago";
import {
  validarArquivoImagemTinta,
  extensaoImagemTinta,
  assinaturaBateComTipo,
  BYTES_ASSINATURA,
} from "@/lib/upload-validacao";
import {
  resolverContextoArmazenamento,
  reservarEspaco,
  confirmarArquivo,
  cancelarReserva,
} from "@/lib/billing/armazenamento";
import { tentarRegistrarAnaliseTinta } from "@/lib/rate-limit-tinta";
import { solicitarAnaliseTinta, ErroWebhookTinta } from "@/lib/webhook-tinta";
import { urlAssinadaLeitura } from "@/lib/blob-assinado";
import { ehConflitoDeSerializacao } from "@/lib/prisma-conflito";

export type AnalisarTintaResult = { ok: boolean; mensagem: string };

// Estimativa de gasto de tinta por IA, a partir de uma imagem da arte — item
// de orçamento, plano pago (Pro/Empresarial, ver src/lib/billing/recursos-pagos.ts,
// "calculo_tinta_ia"), disparado manualmente. Puramente informativo: não
// mexe em preço nem em estoque (ver comentário do model OrcamentoItemTinta
// no schema) — só grava o resultado pra exibição na tela.
export async function analisarTintaItem(
  _estadoAnterior: AnalisarTintaResult | null,
  formData: FormData
): Promise<AnalisarTintaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "ORCAMENTO"))) {
    return { ok: false, mensagem: "Você não tem permissão pra editar orçamentos." };
  }

  // Gate de plano ANTES de qualquer coisa cara (validação de arquivo é
  // barata, tudo através do put() no Blob não é) — síncrono, sem await.
  const acesso = verificarRecursoPago(usuario, "calculo_tinta_ia");
  if (!acesso.liberado) {
    return { ok: false, mensagem: acesso.mensagem };
  }

  const orcamentoItemId = String(formData.get("orcamentoItemId"));
  const arquivo = formData.get("arquivo");
  if (!(arquivo instanceof File)) {
    return { ok: false, mensagem: "Selecione uma imagem." };
  }
  const validacaoArquivo = validarArquivoImagemTinta(arquivo);
  if (!validacaoArquivo.ok) {
    return { ok: false, mensagem: validacaoArquivo.mensagem };
  }
  // Confere a assinatura real do arquivo, não só o Content-Type declarado —
  // mesmo cuidado de enviarArte/salvarLogo (ver upload-validacao.ts).
  const cabecalho = new Uint8Array(await arquivo.slice(0, BYTES_ASSINATURA).arrayBuffer());
  if (!assinaturaBateComTipo(cabecalho, arquivo.type)) {
    return { ok: false, mensagem: "O conteúdo do arquivo não corresponde a uma imagem PNG, JPG ou WEBP." };
  }

  const item = await prisma.orcamentoItem.findFirst({
    where: { id: orcamentoItemId, orcamento: { graficaId: usuario.graficaId } },
    include: {
      orcamento: { select: { status: true, grafica: { select: { nome: true } } } },
      itemGrafica: { include: { itemCatalogo: true } },
      etiqueta: { select: { materialSubstrato: true } },
      tinta: { select: { imagemPathname: true } },
    },
  });
  if (!item) {
    return { ok: false, mensagem: "Item não encontrado." };
  }
  if (item.orcamento.status === "REJEITADO") {
    return { ok: false, mensagem: "Não é possível analisar um orçamento rejeitado." };
  }
  if (item.larguraCm === null || item.alturaCm === null) {
    return { ok: false, mensagem: "Preencha largura e altura do item pra calcular o gasto de tinta." };
  }

  const webhookUrl = process.env.TINTA_WEBHOOK_URL;
  const webhookSecret = process.env.TINTA_WEBHOOK_SECRET;
  if (!webhookUrl || !webhookSecret) {
    return { ok: false, mensagem: "Cálculo de tinta com IA não está configurado." };
  }

  // Rate limit ANTES de gastar armazenamento/token — registrado mesmo se a
  // chamada de rede falhar depois (ver rate-limit-tinta.ts).
  let limite;
  try {
    limite = await tentarRegistrarAnaliseTinta(usuario.id, usuario.graficaId);
  } catch (erro) {
    if (ehConflitoDeSerializacao(erro)) {
      return { ok: false, mensagem: "Muitas análises ao mesmo tempo. Tente de novo em instantes." };
    }
    throw erro;
  }
  if (limite.bloqueado) {
    return { ok: false, mensagem: limite.mensagem ?? "Limite de uso atingido." };
  }

  // Reserva o espaço ANTES do put() — nunca depois, mesmo padrão de
  // enviarArte/salvarLogo (ver src/lib/billing/armazenamento.ts).
  const contextoArmazenamento = resolverContextoArmazenamento(usuario);
  const reserva = await reservarEspaco({
    graficaId: usuario.graficaId,
    tipo: "ANALISE_TINTA",
    referenciaId: orcamentoItemId,
    bytes: arquivo.size,
    contexto: contextoArmazenamento,
  });
  if (!reserva.ok) {
    return { ok: false, mensagem: reserva.mensagem };
  }

  const extensao = extensaoImagemTinta(arquivo.type);
  // access: "private" — desvia de propósito de enviarArte (arte é pública):
  // esta imagem nunca é vista fora do tenant, então nunca deve ganhar URL
  // pública permanente (ver src/lib/blob-assinado.ts).
  let blob;
  try {
    blob = await put(`tinta-analise/${usuario.graficaId}/${orcamentoItemId}-${Date.now()}.${extensao}`, arquivo, {
      access: "private",
      addRandomSuffix: true,
      contentType: arquivo.type,
    });
  } catch (erro) {
    await cancelarReserva(reserva.arquivoId);
    throw erro;
  }
  await confirmarArquivo(reserva.arquivoId, { url: blob.url, pathname: blob.pathname });

  const imagemAnteriorPathname = item.tinta?.imagemPathname ?? null;
  const analiseId = `atn_${crypto.randomUUID()}`;

  let resultado;
  try {
    // 5 min: só o tempo de o n8n baixar e analisar (ver blob-assinado.ts).
    const imagemUrlAssinada = await urlAssinadaLeitura(blob.pathname, 5 * 60 * 1000);
    resultado = await solicitarAnaliseTinta(
      { webhookUrl, secret: webhookSecret },
      {
        analiseId,
        imagemUrl: imagemUrlAssinada,
        imagemTipo: arquivo.type,
        graficaNome: item.orcamento.grafica.nome,
        job: {
          produtoNome: item.itemGrafica.itemCatalogo.nome,
          modeloCalculo: item.modeloCalculo,
          quantidade: item.quantidade,
          larguraCm: Number(item.larguraCm),
          alturaCm: Number(item.alturaCm),
          cores: item.cores,
          corFrente: item.corFrente,
          corVerso: item.corVerso,
          substrato: item.etiqueta?.materialSubstrato ?? null,
        },
      }
    );
  } catch (erro) {
    if (erro instanceof ErroWebhookTinta) {
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }

  const dadosTinta = {
    imagemUrl: blob.url,
    imagemPathname: blob.pathname,
    imagemTipo: arquivo.type,
    coberturaPercentual: resultado.coberturaPercentual,
    coberturaCiano: resultado.coberturaPorCor.ciano,
    coberturaMagenta: resultado.coberturaPorCor.magenta,
    coberturaAmarelo: resultado.coberturaPorCor.amarelo,
    coberturaPreto: resultado.coberturaPorCor.preto,
    consumoMlPorPeca: resultado.consumoMlPorPeca,
    consumoMlTotal: resultado.consumoMlTotal,
    confianca: resultado.confianca.toUpperCase(),
    observacao: resultado.observacao,
    modeloIa: resultado.modelo,
    quantidadeSnapshot: item.quantidade,
    larguraCmSnapshot: item.larguraCm,
    alturaCmSnapshot: item.alturaCm,
    criadoPorUsuarioId: usuario.id,
  };

  await prisma.orcamentoItemTinta.upsert({
    where: { orcamentoItemId },
    create: { orcamentoItemId, ...dadosTinta },
    update: dadosTinta,
  });

  // Melhor esforço, depois que a nova linha já está gravada — mesmo cuidado
  // de enviarArte/salvarLogo. O razão (ArquivoArmazenado) já trocou dentro
  // de confirmarArquivo; aqui só falta apagar o arquivo de verdade.
  if (imagemAnteriorPathname && imagemAnteriorPathname !== blob.pathname) {
    await del(imagemAnteriorPathname).catch(() => {});
  }

  revalidatePath(`/orcamento/${item.orcamentoId}`);
  return { ok: true, mensagem: "Análise concluída!" };
}
