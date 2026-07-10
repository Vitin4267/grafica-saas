"use client";

import { useActionState, useState } from "react";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { alterarClienteOrcamento } from "./actions";

type Cliente = { id: string; nome: string };

export function TrocarClienteForm({
  orcamentoId,
  clienteAtualId,
  clientes,
}: {
  orcamentoId: string;
  clienteAtualId: string;
  clientes: Cliente[];
}) {
  const [state, formAction, isPending] = useActionState(alterarClienteOrcamento, null);
  const [editando, setEditando] = useState(false);

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => setEditando(true)}
        className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
      >
        Trocar cliente
      </button>
    );
  }

  return (
    <form action={formAction} className="flex items-end gap-2">
      <input type="hidden" name="orcamentoId" value={orcamentoId} />
      <div className="min-w-48">
        <Select label="Cliente" name="clienteId" defaultValue={clienteAtualId}>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" variant="outline" loading={isPending}>
        {isPending ? "Salvando..." : "Salvar"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setEditando(false)}>
        Cancelar
      </Button>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
    </form>
  );
}
