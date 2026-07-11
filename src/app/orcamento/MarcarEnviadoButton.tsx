"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { atualizarStatusOrcamento } from "./[id]/actions";

export function MarcarEnviadoButton({ orcamentoId }: { orcamentoId: string }) {
  const [state, formAction, isPending] = useActionState(atualizarStatusOrcamento, null);

  if (state?.ok) {
    return <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Enviado!</span>;
  }

  return (
    <form
      action={formAction}
      onClick={(e) => e.stopPropagation()}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="orcamentoId" value={orcamentoId} />
      <input type="hidden" name="novoStatus" value="ENVIADO" />
      <Button type="submit" variant="outline" loading={isPending} className="!px-3 !py-1.5 text-xs">
        Marcar como enviado
      </Button>
      {state && !state.ok && (
        <span className="text-xs text-rose-600 dark:text-rose-400">{state.mensagem}</span>
      )}
    </form>
  );
}
