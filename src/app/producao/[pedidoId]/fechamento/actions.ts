"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo, podeVerModulo } from "@/lib/auth/permissoes";
import { registrarAuditoria } from "@/lib/auditoria";

export type FecharPedidoResult = { ok: boolean; mensagem: string };

// Fecha o pedido: congela fechadoEm/fechadoPorId (ver fase-custo-real.md
// §3.4). Não apaga nem recalcula nada — a "foto" do resultado é simplesmente
// o estado atual de CustoPedido/PedidoCustoPrevisto no momento em que alguém
// olhar a tela de fechamento depois; fechar só marca "isto está pronto pra
// contar como resultado final". Gate CUSTOS.podeEditar (mesma permissão de
// lançar custo — quem decide o resultado final também precisa poder editar).
export async function fecharPedido(
  _estadoAnterior: FecharPedidoResult | null,
  formData: FormData
): Promise<FecharPedidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "CUSTOS"))) {
    return { ok: false, mensagem: "Você não tem permissão pra fechar este pedido." };
  }

  const pedidoId = String(formData.get("pedidoId"));
  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  if (pedido.fechadoEm) {
    return { ok: false, mensagem: "Este pedido já está fechado." };
  }

  await prisma.pedido.update({
    where: { id: pedidoId },
    data: { fechadoEm: new Date(), fechadoPorId: usuario.id },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "pedido.fechar",
    entidade: "Pedido",
    entidadeId: pedidoId,
    descricao: `Fechou o pedido ${pedidoId}, congelando o resultado (previsto x real).`,
  });

  revalidatePath(`/producao/${pedidoId}/fechamento`);
  revalidatePath("/producao");
  return { ok: true, mensagem: "Pedido fechado." };
}

// Reabre um pedido já fechado — limpa fechadoEm/fechadoPorId. Gate é
// CUSTOS.podeVer, NÃO CUSTOS.podeEditar: decisão explícita do plano
// (fase-custo-real.md §3.4: "Reabrir é possível, exige custosVerLucro e vai
// para auditoria") — quem só enxerga o resultado já pode desfazer o
// fechamento, mesmo sem poder lançar custo. Toda reabertura vai pra
// auditoria, sem exceção.
export async function reabrirPedido(
  _estadoAnterior: FecharPedidoResult | null,
  formData: FormData
): Promise<FecharPedidoResult> {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeVerModulo(usuario, "CUSTOS"))) {
    return { ok: false, mensagem: "Você não tem permissão pra reabrir este pedido." };
  }

  const pedidoId = String(formData.get("pedidoId"));
  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
  });
  if (!pedido) {
    return { ok: false, mensagem: "Pedido não encontrado." };
  }
  if (!pedido.fechadoEm) {
    return { ok: false, mensagem: "Este pedido não está fechado." };
  }

  await prisma.pedido.update({
    where: { id: pedidoId },
    data: { fechadoEm: null, fechadoPorId: null },
  });

  await registrarAuditoria({
    graficaId: usuario.graficaId,
    usuarioId: usuario.id,
    usuarioNome: usuario.nome,
    acao: "pedido.reabrir",
    entidade: "Pedido",
    entidadeId: pedidoId,
    descricao: `Reabriu o pedido ${pedidoId}, que estava fechado.`,
  });

  revalidatePath(`/producao/${pedidoId}/fechamento`);
  revalidatePath("/producao");
  return { ok: true, mensagem: "Pedido reaberto." };
}
