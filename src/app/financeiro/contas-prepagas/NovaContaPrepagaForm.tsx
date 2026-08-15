"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarContaPrepaga } from "./actions";

export function NovaContaPrepagaForm() {
  const [state, formAction, isPending] = useActionState(criarContaPrepaga, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome"
        name="nome"
        type="text"
        placeholder="ex: Lalamove"
        required
        hint="O serviço prepago que você quer controlar o saldo (entrega, frete, etc)."
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova conta"}
      </Button>
    </form>
  );
}
