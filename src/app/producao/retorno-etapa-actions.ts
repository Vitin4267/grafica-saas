"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";
import { resolverEtapasGrafica } from "@/lib/etapa-grafica";
import { fecharEAbrirApontamento } from "@/lib/apontamento-etapa";
import { ORDEM_MOTIVO_RETORNO, rotuloMotivoRetorno } from "@/lib/motivo-retorno";
import type { MotivoRetorno, StatusPedido } from "@/generated/prisma/enums";

// Achado Prod-D2 da Parte 2 (Produção) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, "Não existe retorno de etapa: reprovado
// só pode ser CANCELADO") — a única saída hoje pra um lote reprovado na
// conferência era cancelarPedido, que estorna TODO o estoque e mata o job
// inteiro. Esta action manda o pedido de volta pra uma etapa ANTERIOR
// (retrabalho: "roda de novo os itens que saíram errados"), sem tocar em
// estoque — o material já foi consumido, retrabalho consome MAIS, não
// menos (o consumo adicional entra pelo caminho normal de refugo, achado
// B3, já construído em RefugoEtapaCampos.tsx/aplicarBaixaRefugo).
//
// Deliberadamente um arquivo PRÓPRIO (não dentro de actions.ts, que já
// passa de 900 linhas) — mesmo critério de parada-actions.ts/
// entrega-actions.ts/terceirizacao-actions.ts: uma feature de produção com
// RBAC + CAS + auditoria próprios ganha o arquivo dela.

export type RetornarEtapaResult = { ok: boolean; mensagem: string };

const MENSAGEM_SEM_PERMISSAO = "Você não tem permissão pra retornar a etapa deste pedido.";
const MENSAGEM_CONFLITO =
  "Outra pessoa já alterou este pedido — recarregue a página e confira o status atual.";

const MOTIVOS_VALIDOS = new Set<string>(ORDEM_MOTIVO_RETORNO);

// Mesma ideia de ErroPedidoJaAvancado (status-transicao.ts)/
// ErroPedidoJaAlterado (actions.ts) — sinaliza de DENTRO da transação que o
// status já não é mais o esperado (duplo clique, duas abas), nome próprio
// pra não confundir com os outros dois catches deste módulo.
class ErroPedidoJaAlterado extends Error {}

// Retorna um Pedido pra uma etapa ANTERIOR na sequência resolvida desta
// gráfica (ver resolverEtapasGrafica) — nunca pra frente, nunca pra ela
// mesma, sempre com motivo obrigatório. Permissão: SEMPRE
// PRODUCAO.podeEditar COMPLETO — nunca libera por ResponsavelEstagio
// (diferente de avancarPedido em ./actions.ts): retornar etapa é decisão de
// quem administra a produção (reprovar qualidade, decidir refazer), não do
// operador atribuído a rodar UMA etapa específica.
export async function retornarEtapa(
  _estadoAnterior: RetornarEtapaResult | null,
  formData: FormData
): Promise<RetornarEtapaResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return { ok: false, mensagem: MENSAGEM_SEM_PERMISSAO };
  }

  const pedidoId = String(formData.get("pedidoId") ?? "");
  const etapaDestinoBruta = String(formData.get("etapaDestino") ?? "");
  const motivoBruto = String(formData.get("motivo") ?? "");
  if (!MOTIVOS_VALIDOS.has(motivoBruto)) {
    return { ok: false, mensagem: "Motivo inválido." };
  }
  const motivo = motivoBruto as MotivoRetorno;
  const motivoOutro = String(formData.get("motivoOutro") ?? "").trim().slice(0, 200) || null;
  // Obrigatório quando motivo=OUTRO — servidor nunca confia só na UI, mesmo
  // princípio de "tudo sensível no backend" aplicado em todo xxxOutro do
  // sistema (ver parseRefugoFormData/parada-actions.ts).
  if (motivo === "OUTRO" && !motivoOutro) {
    return { ok: false, mensagem: 'Descreva o motivo quando escolher "Outro".' };
  }

  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
    select: { id: true, graficaId: true, status: true, orcamentoId: true },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  if (pedido.status === "CANCELADO" || pedido.status === "ENTREGUE") {
    return { ok: false, mensagem: "Um pedido finalizado não pode retornar de etapa." };
  }

  // Achado A1 (Fase 1) — sequência resolvida por gráfica (liga/desliga e
  // reordena etapa, ver EtapaGrafica), mesma fonte de verdade que
  // avancarStatusPedido usa. Revalida a etapa de destino no SERVIDOR — nunca
  // confia no que veio do <select> do form.
  const etapas = await resolverEtapasGrafica(usuario.graficaId);
  const indiceAtual = etapas.sequencia.indexOf(pedido.status);
  if (indiceAtual === -1) {
    // Defensivo, mesmo caso-limite de avancarStatusPedido: a etapa atual do
    // pedido foi desativada nas configurações depois que ele chegou lá.
    return {
      ok: false,
      mensagem:
        "A etapa atual deste pedido está desativada nas configurações — reative-a em Configurações > Etapas de produção.",
    };
  }
  const indiceDestino = etapas.sequencia.indexOf(etapaDestinoBruta as StatusPedido);
  if (indiceDestino === -1) {
    return { ok: false, mensagem: "Etapa de destino inválida." };
  }
  // Nunca pra frente, nunca pra ela mesma — só ESTRITAMENTE anterior na
  // sequência ATIVA desta gráfica.
  if (indiceDestino >= indiceAtual) {
    return { ok: false, mensagem: "Só é possível retornar para uma etapa anterior." };
  }
  const etapaDestino = etapas.sequencia[indiceDestino];
  const statusAnterior = pedido.status;

  try {
    await prisma.$transaction(async (tx) => {
      // CAS: updateMany com o status ANTERIOR no where (não update por id) —
      // mesmo padrão de todo o resto de status-transicao.ts/actions.ts.
      const resultado = await tx.pedido.updateMany({
        where: { id: pedido.id, status: statusAnterior },
        data: { status: etapaDestino },
      });
      if (resultado.count === 0) {
        throw new ErroPedidoJaAlterado();
      }

      // Fecha o apontamento atual e abre um novo na etapa de destino,
      // marcado ehRetrabalho:true — reaproveita literalmente o mesmo motor
      // de avancarStatusPedido (fecharEAbrirApontamento), só passando
      // `retorno` (novo parâmetro opcional, ver src/lib/apontamento-etapa.ts)
      // em vez de `refugo`. NUNCA estorna estoque: o material já foi
      // consumido, retrabalho consome MAIS, não menos (o consumo adicional
      // entra pelo caminho normal de refugo, achado B3, não por aqui). NUNCA
      // mexe em Pedido.baixaEstoqueRealizadaEm — esse campo só é setado uma
      // vez, na primeira entrada real em PRODUCAO (ver status-transicao.ts).
      await fecharEAbrirApontamento(tx, {
        graficaId: pedido.graficaId,
        pedidoId: pedido.id,
        proximoStatus: etapaDestino,
        origemConfirmacao: "APP",
        operadorId: usuario.id,
        retorno: { motivoRetorno: motivo, motivoRetornoOutro: motivoOutro },
      });
    });
  } catch (erro) {
    if (erro instanceof ErroPedidoJaAlterado) {
      return { ok: false, mensagem: MENSAGEM_CONFLITO };
    }
    throw erro;
  }

  const descricaoMotivo = rotuloMotivoRetorno(motivo, motivoOutro);
  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "pedido.retornar_etapa",
    entidade: "Pedido",
    entidadeId: pedido.id,
    descricao: `Pedido ${pedido.id} retornado de "${etapas.rotulos[statusAnterior]}" para "${etapas.rotulos[etapaDestino]}" — motivo: ${descricaoMotivo}`,
    valorAnterior: etapas.rotulos[statusAnterior],
    valorNovo: etapas.rotulos[etapaDestino],
  });

  revalidatePath("/producao");
  revalidatePath(`/orcamento/${pedido.orcamentoId}`);
  return { ok: true, mensagem: `Pedido retornado para "${etapas.rotulos[etapaDestino]}".` };
}
