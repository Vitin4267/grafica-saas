"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarDespesa } from "./actions";

export function NovaDespesaForm() {
  const [state, formAction, isPending] = useActionState(criarDespesa, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Descrição"
          name="descricao"
          type="text"
          placeholder="ex: Papel Couché 300g - Distribuidora X"
          required
          className="sm:col-span-2"
        />
        <Input label="Categoria (opcional)" name="categoria" type="text" placeholder="ex: Fornecedor, Aluguel" />
        <Input label="Valor (R$)" name="valor" type="number" step="0.01" min="0.01" required />
        <Input label="Vencimento" name="vencimento" type="date" required className="sm:col-span-2" />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="recorrente"
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span>
          <span className="block font-medium text-slate-700 dark:text-slate-200">
            Repetir todo mês
          </span>
          <span className="block text-xs text-slate-500">
            Pra conta fixa (aluguel, internet) — lança sozinha no mesmo dia todo mês, sem
            precisar recadastrar.
          </span>
        </span>
      </label>
      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Cadastrando..." : "+ Nova despesa"}
      </Button>
    </form>
  );
}
