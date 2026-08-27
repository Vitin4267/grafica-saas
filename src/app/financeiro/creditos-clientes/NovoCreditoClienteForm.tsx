"use client";

import { useActionState } from "react";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { abrirCreditoCliente } from "./actions";

type Cliente = { id: string; nome: string };

export function NovoCreditoClienteForm({ clientes }: { clientes: Cliente[] }) {
  const [state, formAction, isPending] = useActionState(abrirCreditoCliente, null);

  return (
    <form action={formAction} className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <div className="min-w-56 flex-1">
        <Select label="Cliente" name="clienteId" required defaultValue="">
          <option value="" disabled>
            Selecione um cliente
          </option>
          {clientes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Select>
      </div>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start sm:self-end">
        {isPending ? "Abrindo..." : "Abrir extrato"}
      </Button>
    </form>
  );
}
