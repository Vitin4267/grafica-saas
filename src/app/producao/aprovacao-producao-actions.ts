"use server";

import { revalidatePath } from "next/cache";
import { put } from "@vercel/blob";
import { opcoesBlobPublico } from "@/lib/blob-store";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import {
  validarArquivoArte,
  extensaoArte,
  assinaturaBateComTipo,
  BYTES_ASSINATURA,
} from "@/lib/upload-validacao";
import {
  resolverContextoArmazenamento,
  reservarEspaco,
  confirmarArquivo,
  cancelarReserva,
} from "@/lib/billing/armazenamento";
import type { TipoAprovacaoProducao, ResultadoAprovacao } from "@/generated/prisma/enums";

// Achado D1 da auditoria de abrangência (Parte 2/Produção,
// pesquisa-abrangencia-modulos.md, 2026-09-11) — registra uma
// AprovacaoProducao (OK de máquina, inspeção, prova de contrato...), o dado
// que o gate opt-in de EtapaGrafica.exigeAprovacaoQualidade em
// avancarStatusPedido (status-transicao.ts) exige antes de liberar a saída
// de uma etapa marcada. Arquivo próprio (não producao/actions.ts, que já
// está grande) por decisão de tamanho — mesmo critério de parada-actions.ts/
// terceirizacao-actions.ts terem saído de actions.ts em rodadas anteriores.
//
// SEMPRE registrado por um usuário LOGADO do sistema (aprovadoPorId), nunca
// pelo cliente — a única exceção prevista no schema (AMOSTRA_CLIENTE,
// aprovação pelo cliente via link público) está deliberadamente FORA de
// escopo nesta rodada: quem registrar um AMOSTRA_CLIENTE hoje passa por
// este MESMO caminho interno, sem nenhuma tela pública por trás ainda.

export type RegistrarAprovacaoProducaoResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra editar a produção.";

const TIPOS_VALIDOS = new Set<TipoAprovacaoProducao>([
  "OK_MAQUINA",
  "PROVA_CONTRATO",
  "AMOSTRA_CLIENTE",
  "INSPECAO_PROCESSO",
  "INSPECAO_FINAL",
  "OUTRO",
]);

const RESULTADOS_VALIDOS = new Set<ResultadoAprovacao>([
  "APROVADO",
  "APROVADO_COM_RESSALVA",
  "REPROVADO",
]);

export async function registrarAprovacaoProducao(
  _estadoAnterior: RegistrarAprovacaoProducaoResult | null,
  formData: FormData
): Promise<RegistrarAprovacaoProducaoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const pedidoId = String(formData.get("pedidoId") ?? "");
  const tipoBruto = String(formData.get("tipo") ?? "");
  if (!TIPOS_VALIDOS.has(tipoBruto as TipoAprovacaoProducao)) {
    return { ok: false, mensagem: "Tipo de aprovação inválido." };
  }
  const tipo = tipoBruto as TipoAprovacaoProducao;
  const tipoOutroBruto = String(formData.get("tipoOutro") ?? "").trim().slice(0, 200) || null;
  if (tipo === "OUTRO" && !tipoOutroBruto) {
    return { ok: false, mensagem: 'Descreva o tipo quando escolher "Outro".' };
  }

  const resultadoBruto = String(formData.get("resultado") ?? "");
  if (!RESULTADOS_VALIDOS.has(resultadoBruto as ResultadoAprovacao)) {
    return { ok: false, mensagem: "Resultado inválido." };
  }
  const resultado = resultadoBruto as ResultadoAprovacao;

  // Preenchido só quando quem registra NÃO é o próprio usuário logado (ex:
  // operador do chão de fábrica ditando pro encarregado lançar) — mesmo
  // padrão de "nome declarado" de ApontamentoEtapa.operadorNomeDeclarado.
  // aprovadoPorId (abaixo) é SEMPRE o usuário autenticado que submeteu o
  // formulário — os dois campos não são alternativos, coexistem.
  const aprovadoPorNomeDeclarado =
    String(formData.get("aprovadoPorNomeDeclarado") ?? "").trim().slice(0, 200) || null;
  const observacao = String(formData.get("observacao") ?? "").trim().slice(0, 2000) || null;

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    select: { id: true, status: true },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  if (pedido.status === "CANCELADO") {
    return { ok: false, mensagem: "Um pedido cancelado não pode receber novas aprovações." };
  }

  // Mesma etapa ABERTA (finalizadoEm null) do pedido no momento do registro
  // — mesmo critério já usado por ParadaPedido.apontamentoEtapaId
  // (parada-actions.ts), e o que o gate em avancarStatusPedido
  // (status-transicao.ts) usa pra amarrar a exigência à passagem ATUAL por
  // esta etapa. null (raro — pedido sem histórico de apontamento pra esta
  // etapa, ex: dado anterior ao achado B1/B2) é aceito: a aprovação ainda é
  // registrada, só cai no fallback "vale pro pedido inteiro" documentado no
  // gate.
  const apontamentoAtivo = await prisma.apontamentoEtapa.findFirst({
    where: { pedidoId, status: pedido.status, finalizadoEm: null },
    select: { id: true },
  });

  // Foto é OPCIONAL — campo ausente ou input vazio nunca é erro, só pula o
  // bloco de upload abaixo.
  const arquivoBruto = formData.get("arquivo");
  const temArquivo = arquivoBruto instanceof File && arquivoBruto.size > 0;
  const arquivo = temArquivo ? (arquivoBruto as File) : null;

  if (arquivo) {
    // Mesma validação de tipo/tamanho (PDF/JPG/PNG, até 30MB) e de
    // assinatura real do arquivo (magic bytes, não só Content-Type
    // declarado) já usada por enviarArte (producao/actions.ts) — reaproveita
    // o mesmo mecanismo de upload do chão de fábrica em vez de inventar um
    // novo, mesmo que o nome das funções diga "Arte": a regra de negócio
    // (PDF/JPG/PNG pequeno, hospedado publicamente no Blob) é idêntica pra
    // foto de conferência.
    const validacao = validarArquivoArte(arquivo);
    if (!validacao.ok) {
      return { ok: false, mensagem: validacao.mensagem };
    }
    const cabecalho = new Uint8Array(await arquivo.slice(0, BYTES_ASSINATURA).arrayBuffer());
    if (!assinaturaBateComTipo(cabecalho, arquivo.type)) {
      return { ok: false, mensagem: "O conteúdo do arquivo não corresponde a um PDF, JPG ou PNG." };
    }
  }

  // Cria a linha ANTES de subir a foto — precisa do id PRÓPRIO da
  // AprovacaoProducao pra usar como referenciaId em ArquivoArmazenado (ver
  // comentário completo em TipoArquivoArmazenado.FOTO_APROVACAO_PRODUCAO no
  // schema). Diferente de enviarArte (referenciaId=pedidoId, que já existe
  // antes do upload e é 1:1 com a arte), aqui um mesmo pedido pode ter
  // VÁRIAS aprovações ao longo da produção — usar pedidoId como
  // referenciaId faria confirmarArquivo (que apaga qualquer linha ANTERIOR
  // do mesmo tipo+referenciaId) apagar a foto de uma aprovação toda vez que
  // outra é registrada.
  const aprovacao = await prisma.aprovacaoProducao.create({
    data: {
      graficaId: usuario.graficaId,
      pedidoId,
      apontamentoEtapaId: apontamentoAtivo?.id ?? null,
      tipo,
      tipoOutro: tipo === "OUTRO" ? tipoOutroBruto : null,
      resultado,
      aprovadoPorId: usuario.id,
      aprovadoPorNomeDeclarado,
      observacao,
    },
  });

  let mensagemFoto = "";
  if (arquivo) {
    const contextoArmazenamento = resolverContextoArmazenamento(usuario);
    const reserva = await reservarEspaco({
      graficaId: usuario.graficaId,
      tipo: "FOTO_APROVACAO_PRODUCAO",
      referenciaId: aprovacao.id,
      bytes: arquivo.size,
      contexto: contextoArmazenamento,
    });
    if (!reserva.ok) {
      // A aprovação em si JÁ foi registrada — a foto é um extra opcional,
      // nunca vale descartar o registro de qualidade por causa de cota de
      // armazenamento cheia. Devolve sucesso, só avisando que a foto não
      // entrou.
      mensagemFoto = ` A foto não foi salva: ${reserva.mensagem}`;
    } else {
      const extensao = extensaoArte(arquivo.type);
      try {
        const blob = await put(
          `producao-aprovacao/${usuario.graficaId}/${aprovacao.id}-${Date.now()}.${extensao}`,
          arquivo,
          { access: "public", addRandomSuffix: true, contentType: arquivo.type, ...opcoesBlobPublico() }
        );
        await confirmarArquivo(reserva.arquivoId, { url: blob.url, pathname: blob.pathname });
        await prisma.aprovacaoProducao.update({
          where: { id: aprovacao.id },
          data: { arquivoId: reserva.arquivoId },
        });
      } catch (erro) {
        await cancelarReserva(reserva.arquivoId);
        console.error(
          "[registrarAprovacaoProducao] falha ao subir foto no Vercel Blob",
          { graficaId: usuario.graficaId, pedidoId, aprovacaoId: aprovacao.id },
          erro
        );
        mensagemFoto = " Não foi possível salvar a foto agora.";
      }
    }
  }

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "aprovacao_producao.registrar",
    entidade: "AprovacaoProducao",
    entidadeId: aprovacao.id,
    descricao: `Aprovação de qualidade (${tipo}) registrada pro pedido ${pedidoId} — resultado ${resultado}`,
  });

  revalidatePath("/producao");
  return { ok: true, mensagem: `Aprovação registrada.${mensagemFoto}` };
}
