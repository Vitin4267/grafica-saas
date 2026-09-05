"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoCategoriaDespesa } from "./CampoCategoriaDespesa";
import { ROTULO_PERIODICIDADE } from "./periodicidade";
import { criarDespesa } from "./actions";

export function NovaDespesaForm({
  categoriasCusto,
  filiais = [],
}: {
  categoriasCusto: { id: string; nome: string }[];
  filiais?: { id: string; nome: string }[];
}) {
  const [state, formAction, isPending] = useActionState(criarDespesa, null);
  const [recorrente, setRecorrente] = useState(false);

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
        <CampoCategoriaDespesa categorias={categoriasCusto} />
        <Input label="Valor (R$)" name="valor" type="number" step="0.01" min="0.01" required />
        <Input label="Vencimento" name="vencimento" type="date" required className="sm:col-span-2" />
        {filiais.length > 0 && (
          <Select label="Filial (opcional)" name="filialId" defaultValue="" className="sm:col-span-2">
            <option value="">Sem filial específica</option>
            {filiais.map((filial) => (
              <option key={filial.id} value={filial.id}>
                {filial.nome}
              </option>
            ))}
          </Select>
        )}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="recorrente"
          checked={recorrente}
          onChange={(evento) => setRecorrente(evento.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span>
          <span className="block font-medium text-slate-700 dark:text-slate-200">
            Repetir
          </span>
          <span className="block text-xs text-slate-500">
            Pra conta fixa (aluguel, internet) — lança sozinha no mesmo dia, sem
            precisar recadastrar.
          </span>
        </span>
      </label>
      {recorrente && (
        <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700 sm:grid-cols-2">
          <Select label="Repete a cada" name="periodicidade" defaultValue="MENSAL">
            {Object.entries(ROTULO_PERIODICIDADE).map(([valor, rotulo]) => (
              <option key={valor} value={valor}>
                {rotulo}
              </option>
            ))}
          </Select>
          <Input
            label="Repetir até (opcional)"
            name="recorrenciaAteEm"
            type="date"
            hint="Em branco = sem data pra parar"
          />
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              name="valorVariavel"
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
            />
            <span>
              <span className="block font-medium text-slate-700 dark:text-slate-200">
                Valor variável a cada ocorrência
              </span>
              <span className="block text-xs text-slate-500">
                Pra conta que muda de valor (ex: luz, água) — cada ocorrência nasce "a
                confirmar" (R$ 0,00) até você editar o valor real.
              </span>
            </span>
          </label>
        </div>
      )}
      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Cadastrando..." : "+ Nova despesa"}
      </Button>
    </form>
  );
}
