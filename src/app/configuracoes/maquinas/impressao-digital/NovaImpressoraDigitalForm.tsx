"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarImpressoraDigital } from "./actions";

export function NovaImpressoraDigitalForm() {
  const [state, formAction, isPending] = useActionState(criarImpressoraDigital, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome"
        name="nome"
        type="text"
        placeholder="ex: HP Indigo 12000"
        required
        hint="O custo por clique você ajusta na tela seguinte."
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova impressora"}
      </Button>
    </form>
  );
}
