"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { avancarPedido } from "./actions";

const PROXIMO_ROTULO: Record<string, string> = {
  FILA: "Iniciar impressão",
  IMPRESSAO: "Enviar p/ acabamento",
  ACABAMENTO: "Marcar como pronto",
  PRONTO: "Marcar como entregue",
};

export function AvancarPedidoButton({
  pedidoId,
  status,
}: {
  pedidoId: string;
  status: string;
}) {
  const [state, formAction, isPending] = useActionState(avancarPedido, null);

  if (status === "ENTREGUE") {
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
