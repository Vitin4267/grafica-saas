"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { removerFeriado } from "./actions";

export function RemoverFeriadoForm({ feriadoId, descricao }: { feriadoId: string; descricao: string }) {
  const [state, formAction, isPending] = useActionState(removerFeriado, null);

  return (
    <form
      action={formAction}
      onSubmit={(evento) => {
        if (!window.confirm(`Remover o feriado "${descricao}"?`)) evento.preventDefault();
      }}
      className="flex flex-col items-end gap-2"
    >
      <input type="hidden" name="feriadoId" value={feriadoId} />
      <Button
        type="submit"
        variant="ghost"
        loading={isPending}
        className="text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/50"
      >
        Remover
      </Button>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
    </form>
  );
}
