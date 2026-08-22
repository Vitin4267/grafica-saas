"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { avancarPedido } from "./actions";

// CLICHE_FACA fica de fora deste mapa de propósito: essa transição baixa
// estoque automaticamente (ver avancarStatusPedido), então PedidoLinha.tsx
// mostra IniciarImpressaoBotao (fluxo de confirmação editável) em vez deste
// botão de um clique só quando o status é CLICHE_FACA.
const PROXIMO_ROTULO: Record<string, string> = {
  ARTE: "Enviar p/ clichê/faca",
  PRODUCAO: "Enviar p/ acabamento",
  ACABAMENTO: "Enviar p/ conferência",
  CONFERENCIA: "Enviar p/ embalagem",
  EMBALAGEM: "Enviar p/ expedição",
  EXPEDICAO: "Marcar como entregue",
};

export function AvancarPedidoButton({
  pedidoId,
  status,
}: {
  pedidoId: string;
  status: string;
}) {
  const [state, formAction, isPending] = useActionState(avancarPedido, null);

  if (status === "ENTREGUE" || status === "CANCELADO") {
    return null;
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <Button type="submit" variant="outline" loading={isPending}>
        {PROXIMO_ROTULO[status] ?? "Avançar"}
      </Button>
      {state && !state.ok && (
        <span className="text-xs text-rose-600">{state.mensagem}</span>
      )}
    </form>
  );
}
