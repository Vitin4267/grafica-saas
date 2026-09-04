"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  resolverDadosFiscais,
  resolverCfopTerceirizacao,
  fornecedorProntoParaNfe,
  NATUREZA_OPERACAO_TERCEIRIZACAO,
} from "@/lib/nota-fiscal";
import { emitirNfe, ErroFocusNfe, type AmbienteFocusNfe } from "@/lib/focus-nfe";

// Achado R3 da auditoria de abrangência (Parte 2/Produção, rodada 20,
// 2026-09-03, resíduo do achado E1/Parte 2) — emite a NF-e de REMESSA pra
// industrialização (CFOP 5901/6901) de uma EtapaTerceirizada direto do
// sistema, via Focus NFe da PRÓPRIA gráfica, em vez de só digitar o número
// de uma nota emitida fora do sistema em notaRemessa.
//
// Só a REMESSA: o RETORNO (CFOP 5902/6902) é fiscalmente uma saída do
// ESTABELECIMENTO TERCEIRIZADO (quem devolve a mercadoria já
// industrializada), nunca da gráfica — que só o RECEBE de volta. Como este
// sistema só tem a conta Focus NFe da PRÓPRIA gráfica (nunca a do
// terceiro), não há como emitir essa nota por aqui — notaRetorno continua
// sendo só texto livre, comportamento inalterado (ver schema.prisma, model
// EtapaTerceirizada, e o resumo da rodada 20/R3).
//
// A gráfica não tem, hoje, uma ficha técnica/NCM associada à MATÉRIA-PRIMA
// especificamente enviada pra terceirização (diferente do item vendido ao
// cliente final, que já tem NCM configurado no catálogo) — por isso
// descrição/NCM/situação tributária do ICMS são digitados aqui, na hora da
// emissão, em vez de vir de um cadastro. icmsAliquota/baseCalculo/
// modalidade NUNCA são enviados (mesmo branch de mapearItemNfePayload usado
// pra Simples Nacional): remessa/retorno de industrialização não têm fato
// gerador de ICMS na operação em si (é suspensão/não tributação, não uma
// venda), então calcular um valor de ICMS aqui seria inventar imposto que
// não existe — só o código da situação tributária (CST ou CSOSN) é
// enviado, exatamente como a gráfica digitar.

export type EmitirNfeRemessaTerceirizacaoResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar a produção.";

export async function emitirNfeRemessaTerceirizacao(
  _estadoAnterior: EmitirNfeRemessaTerceirizacaoResult | null,
  formData: FormData
): Promise<EmitirNfeRemessaTerceirizacaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const etapaId = String(formData.get("etapaId") ?? "");
  const descricao = String(formData.get("descricao") ?? "").trim().slice(0, 200);
  const ncm = String(formData.get("ncm") ?? "").trim().replace(/\D/g, "");
  const icmsSituacaoTributaria = String(formData.get("icmsSituacaoTributaria") ?? "").trim();
  const valorBruto = Number(String(formData.get("valor") ?? "").trim());

  if (!descricao) {
    return { ok: false, mensagem: "Descreva o que está sendo enviado pra industrialização." };
  }
  if (!ncm) {
    return { ok: false, mensagem: "Informe o NCM da mercadoria enviada." };
  }
  if (!icmsSituacaoTributaria) {
    return { ok: false, mensagem: "Informe a situação tributária do ICMS (CST ou CSOSN)." };
  }
  if (!Number.isFinite(valorBruto) || valorBruto <= 0) {
    return { ok: false, mensagem: "Informe um valor válido pra mercadoria enviada." };
  }

  const etapa = await prisma.etapaTerceirizada.findFirst({
    where: { id: etapaId, graficaId: usuario.graficaId },
    include: {
      fornecedor: true,
      pedido: { select: { orcamento: { select: { filialId: true } } } },
    },
  });
  if (!etapa) {
    return { ok: false, mensagem: "Terceirização não encontrada." };
  }
  if (etapa.remessaNfeStatus === "AUTORIZADA") {
    return { ok: false, mensagem: "A NF-e de remessa desta terceirização já foi autorizada." };
  }
  // Fornecedor cadastrado (não nome livre) é exigido — um nome digitado não
  // tem CNPJ/CPF nem endereço pra virar destinatário de uma NF-e real. Ver
  // comentário no schema (model Fornecedor) e fornecedorProntoParaNfe.
  if (!etapa.fornecedorId || !etapa.fornecedor) {
    return {
      ok: false,
      mensagem:
        "Emissão automática só está disponível pra fornecedor cadastrado (Configurações → Fornecedores), não pra nome digitado.",
    };
  }
  if (!fornecedorProntoParaNfe(etapa.fornecedor)) {
    return {
      ok: false,
      mensagem:
        "Cadastre CNPJ/CPF e endereço completos deste fornecedor em Configurações → Fornecedores antes de emitir.",
    };
  }

  const dadosFiscais = await resolverDadosFiscais(etapa.pedido.orcamento.filialId, usuario.graficaId);
  if (!dadosFiscais?.focusNfeToken) {
    return { ok: false, mensagem: "Token da Focus NFe não configurado (Configurações → Dados fiscais)." };
  }
  if (
    !dadosFiscais.cnpj ||
    !dadosFiscais.razaoSocial ||
    !dadosFiscais.enderecoLogradouro ||
    !dadosFiscais.enderecoNumero ||
    !dadosFiscais.enderecoBairro ||
    !dadosFiscais.enderecoMunicipio ||
    !dadosFiscais.enderecoUf ||
    !dadosFiscais.enderecoCep
  ) {
    return {
      ok: false,
      mensagem: "CNPJ, razão social e endereço da gráfica precisam estar completos (Configurações → Dados fiscais).",
    };
  }

  const fornecedor = etapa.fornecedor;

  try {
    const resposta = await emitirNfe(
      { token: dadosFiscais.focusNfeToken, ambiente: dadosFiscais.ambiente as AmbienteFocusNfe },
      {
        referencia: `terceirizacao-remessa-${etapa.id}`,
        naturezaOperacao: NATUREZA_OPERACAO_TERCEIRIZACAO.REMESSA,
        emitente: {
          cnpj: dadosFiscais.cnpj,
          nome: dadosFiscais.razaoSocial,
          nomeFantasia: dadosFiscais.nomeFantasia || dadosFiscais.razaoSocial,
          inscricaoEstadual: dadosFiscais.inscricaoEstadual ?? "",
          logradouro: dadosFiscais.enderecoLogradouro,
          numero: dadosFiscais.enderecoNumero,
          bairro: dadosFiscais.enderecoBairro,
          municipio: dadosFiscais.enderecoMunicipio,
          uf: dadosFiscais.enderecoUf,
          cep: dadosFiscais.enderecoCep,
        },
        destinatario: {
          documento: fornecedor.documento!,
          nome: fornecedor.nome,
          logradouro: fornecedor.enderecoLogradouro!,
          numero: fornecedor.enderecoNumero!,
          bairro: fornecedor.enderecoBairro!,
          municipio: fornecedor.enderecoMunicipio!,
          uf: fornecedor.enderecoUf!,
          cep: fornecedor.enderecoCep!,
        },
        itens: [
          {
            numeroItem: 1,
            codigoProduto: etapa.id,
            descricao,
            ncm,
            cfop: resolverCfopTerceirizacao({
              ufEmitente: dadosFiscais.enderecoUf,
              ufFornecedor: fornecedor.enderecoUf,
              tipo: "REMESSA",
            }),
            unidade: "UN",
            quantidade: 1,
            valorUnitario: valorBruto,
            valorBruto,
            icmsSituacaoTributaria,
          },
        ],
        valorTotal: valorBruto,
      }
    );

    const statusNota =
      resposta.status === "autorizado"
        ? "AUTORIZADA"
        : resposta.status === "erro_autorizacao" || resposta.status === "denegado"
          ? "REJEITADA"
          : "PROCESSANDO";

    await prisma.etapaTerceirizada.update({
      where: { id: etapa.id },
      data: {
        remessaNfeStatus: statusNota,
        remessaNfeNumero: resposta.numero,
        remessaNfeSerie: resposta.serie,
        remessaNfeChaveAcesso: resposta.chaveNfe,
        remessaNfeXmlUrl: resposta.caminhoXml,
        remessaNfeDanfeUrl: resposta.caminhoDanfe,
        remessaNfeMensagemErro: resposta.mensagemErro ?? resposta.mensagemSefaz,
        // notaRemessa (texto livre) também é preenchido quando a emissão dá
        // certo, pra continuar aparecendo em qualquer lugar que já lê esse
        // campo antigo — nunca sobrescreve um número já digitado à mão se a
        // emissão falhar (branch AUTORIZADA/PROCESSANDO só).
        ...(resposta.numero && statusNota !== "REJEITADA" ? { notaRemessa: resposta.numero } : {}),
      },
    });

    await registrarAuditoria({
      graficaId: usuario.graficaId,
      usuarioId: usuario.id,
      usuarioNome: usuario.nome,
      acao: "etapa_terceirizada.emitir_nfe_remessa",
      entidade: "EtapaTerceirizada",
      entidadeId: etapa.id,
      descricao: `NF-e de remessa pra industrialização emitida (${fornecedor.nome})`,
    });
  } catch (erro) {
    if (erro instanceof ErroFocusNfe) {
      return { ok: false, mensagem: erro.message };
    }
    throw erro;
  }

  revalidatePath("/producao");
  return { ok: true, mensagem: "NF-e de remessa enviada pra processamento!" };
}
