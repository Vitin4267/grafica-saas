import "server-only";

import type { AssinaturaGrafica } from "@/generated/prisma/client";
import { obterPlanoPorPriceId } from "@/lib/billing/planos";
import { podeUsarRecursoPago, type RecursoPago, type AcessoRecursoPago } from "@/lib/billing/recursos-pagos";

// Irmão de podeEditarModulo/podeVerModulo (src/lib/auth/permissoes.ts), só
// que por PLANO em vez de por papel — e SÍNCRONO, sem await: a assinatura já
// vem junto do usuário na query de sessão (obterUsuarioAtual, ver
// src/lib/auth/session.ts), então isto não custa round-trip nenhum. Não
// adicione await no call site.
//
// Composição: NÃO substitui exigirEmailVerificado/exigirAssinaturaAtiva —
// roda DEPOIS dos dois, como uma camada a mais. Aqueles respondem "esta
// gráfica pode usar o produto?"; este responde "o plano dela paga por ESTE
// recurso específico?". E roda ANTES de qualquer put() no Blob ou chamada de
// IA — o gate só vale alguma coisa se checado antes do dinheiro ser gasto.
export function verificarRecursoPago(
  usuario: { grafica: { assinatura: AssinaturaGrafica | null } },
  recurso: RecursoPago
): AcessoRecursoPago {
  const assinatura = usuario.grafica.assinatura;
  return podeUsarRecursoPago(recurso, {
    status: assinatura?.status ?? null,
    cortesia: assinatura?.cortesia ?? false,
    planoId: obterPlanoPorPriceId(assinatura?.stripePriceId ?? null)?.id ?? null,
  });
}
