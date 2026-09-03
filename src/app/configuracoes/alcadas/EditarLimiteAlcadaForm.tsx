"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { editarAlcada, excluirAlcada } from "./actions";

// Edita só o LIMITE (campo "quente" — ver comentário de editarAlcada em
// actions.ts) + exclui — as duas ações que fazem sentido numa linha já
// cadastrada. Dois <form> lado a lado (mesmo padrão de
// RemoverFeriadoForm), cada um com seu próprio useActionState.
export function EditarLimiteAlcadaForm({
  alcadaId,
  limiteInicial,
  unidade,
  descricaoAlvo,
}: {
  alcadaId: string;
  limiteInicial: number;
  unidade: string;
  descricaoAlvo: string;
}) {
  const [stateEditar, formActionEditar, isPendingEditar] = useActionState(editarAlcada, null);
  const [stateExcluir, formActionExcluir, isPendingExcluir] = useActionState(excluirAlcada, null);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <form action={formActionEditar} className="flex items-center gap-2">
          <input type="hidden" name="alcadaId" value={alcadaId} />
          <span className="text-sm text-slate-500">{unidade}</span>
          <input
            type="number"
            name="limite"
            defaultValue={limiteInicial}
            step="0.01"
            min="0.01"
            aria-label={`Limite da alçada de ${descricaoAlvo}`}
            className="w-24 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
          <Button type="submit" variant="outline" loading={isPendingEditar} className="px-3 py-1.5 text-xs">
            Salvar
          </Button>
        </form>

        <form
          action={formActionExcluir}
          onSubmit={(evento) => {
            if (!window.confirm(`Excluir a alçada de "${descricaoAlvo}"?`)) evento.preventDefault();
          }}
        >
          <input type="hidden" name="alcadaId" value={alcadaId} />
          <Button
            type="submit"
            variant="ghost"
            loading={isPendingExcluir}
            className="px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/50"
          >
            Excluir
          </Button>
        </form>
      </div>
      {stateEditar && !stateEditar.ok && <Alert variant="error">{stateEditar.mensagem}</Alert>}
      {stateExcluir && !stateExcluir.ok && <Alert variant="error">{stateExcluir.mensagem}</Alert>}
    </div>
  );
}
