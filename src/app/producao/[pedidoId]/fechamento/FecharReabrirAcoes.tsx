"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Button } from "@/components/ui/Button";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { fecharPedido, reabrirPedido } from "./actions";

// Mesmo padrão de PedidoLinha.tsx (cancelarPedido): confirmação inline em
// vez de agir no primeiro clique, já que fechar/reabrir muda o "resultado
// oficial" do pedido (ver fase-custo-real.md §3.4).
export function FecharPedidoBotao({ pedidoId }: { pedidoId: string }) {
  const [state, formAction, isPending] = useActionState(fecharPedido, null);
  const [confirmando, setConfirmando] = useState(false);

  useAoMudar(state, (state) => {
    if (state && !state.ok) setConfirmando(false);
  });

  if (confirmando) {
    return (
      <ConfirmarExclusao
        pergunta="Fechar este pedido? O resultado (previsto x real) fica congelado — dá pra reabrir depois, se precisar."
        onCancelar={() => setConfirmando(false)}
        formAction={formAction}
        campos={{ pedidoId }}
        rotuloBotao="Fechar pedido"
        pendente={isPending}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" onClick={() => setConfirmando(true)}>
        Fechar pedido
      </Button>
      {state && !state.ok && <p className="text-xs text-rose-600">{state.mensagem}</p>}
    </div>
  );
}

export function ReabrirPedidoBotao({ pedidoId }: { pedidoId: string }) {
  const [state, formAction, isPending] = useActionState(reabrirPedido, null);
  const [confirmando, setConfirmando] = useState(false);

  useAoMudar(state, (state) => {
    if (state && !state.ok) setConfirmando(false);
  });

  if (confirmando) {
    return (
      <ConfirmarExclusao
        pergunta="Reabrir este pedido? A foto do resultado congelado deixa de valer até fechar de novo — fica registrado na auditoria."
        onCancelar={() => setConfirmando(false)}
        formAction={formAction}
        campos={{ pedidoId }}
        rotuloBotao="Reabrir pedido"
        pendente={isPending}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" onClick={() => setConfirmando(true)}>
        Reabrir
      </Button>
      {state && !state.ok && <p className="text-xs text-rose-600">{state.mensagem}</p>}
    </div>
  );
}
