import "server-only";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import type { AssinaturaGrafica } from "@/generated/prisma/client";
import { assinaturaEstaLiberada } from "@/lib/billing/status";
import { obterPlanoPorPriceId } from "@/lib/billing/planos";
import { limiteExcedido, deveBloquearPorLimite, deveResetarJanelaExcedente } from "@/lib/billing/limite-uso";
import { calcularUsoAtual } from "@/lib/billing/uso";

// Chamado logo depois de exigirUsuarioAutenticado() em toda página/Server
// Action/Route Handler do app (exceto /configuracoes/assinatura em si e
// logout, senão vira loop de redirect) — "está logado" e "pode usar o
// produto" são checagens separadas de propósito, pra não misturar no
// primitivo de baixo nível.
//
// Além do status da assinatura (trial/ativa/vencida), também aplica o
// limite de uso do plano (orçamentos/mês + usuários — ver
// src/lib/billing/limite-uso.ts): ao ultrapassar o teto, não bloqueia na
// hora, só marca o início de uma janela de tolerância de 15 dias
// (limiteExcedidoDesde). Só depois de vencida essa janela é que bloqueia.
//
// A assinatura vem junto do usuário (usuario.grafica.assinatura) porque
// obterUsuarioAtual() já a inclui na mesma query de sessão — evita um
// round-trip próprio aqui, que rodava em toda navegação. Ver
// src/lib/auth/session.ts.
export async function exigirAssinaturaAtiva(usuario: {
  graficaId: string;
  grafica: { assinatura: AssinaturaGrafica | null };
}) {
  const assinatura = usuario.grafica.assinatura;
  if (!assinaturaEstaLiberada(assinatura)) {
    redirect("/configuracoes/assinatura");
  }
  const assinaturaAtiva = assinatura!;

  // Limite de uso só se aplica a plano PAGO ativo — trial já é liberação
  // completa por tempo determinado, sem noção de teto de uso.
  if (assinaturaAtiva.status !== "ATIVA") return;

  const plano = obterPlanoPorPriceId(assinaturaAtiva.stripePriceId);
  if (!plano) return; // grandfathered sem price reconhecido — sem limite aplicável

  const uso = await calcularUsoAtual(usuario.graficaId);
  const excede = limiteExcedido(uso, plano);

  if (excede && !assinaturaAtiva.limiteExcedidoDesde) {
    await prisma.assinaturaGrafica.update({
      where: { graficaId: usuario.graficaId },
      data: { limiteExcedidoDesde: new Date() },
    });
  } else if (
    !excede &&
    assinaturaAtiva.limiteExcedidoDesde &&
    deveResetarJanelaExcedente(assinaturaAtiva.limiteExcedidoDesde)
  ) {
    await prisma.assinaturaGrafica.update({
      where: { graficaId: usuario.graficaId },
      data: { limiteExcedidoDesde: null },
    });
  } else if (excede && deveBloquearPorLimite(assinaturaAtiva.limiteExcedidoDesde)) {
    redirect("/configuracoes/assinatura");
  }
}
