"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarFeriado } from "./actions";

export function NovoFeriadoForm() {
  const [state, formAction, isPending] = useActionState(criarFeriado, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Data" name="data" type="date" required />
        <Input
          label="Descrição"
          name="descricao"
          type="text"
          placeholder="ex: Aniversário da cidade"
          required
        />
      </div>
      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          name="recorrenteAnual"
          className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
          Recorrente todo ano
        </span>
      </label>
      <p className="text-xs text-slate-500">
        Marque pra feriados de data fixa (ex: 25/12) — eles não precisam ser
        recadastrados ano a ano. Deixe desmarcado pra feriados com data móvel
        (Carnaval, Corpus Christi), que mudam de dia a cada ano.
      </p>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Cadastrando..." : "+ Novo feriado"}
      </Button>
    </form>
  );
}
