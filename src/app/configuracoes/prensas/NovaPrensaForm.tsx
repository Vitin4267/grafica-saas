"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarPrensa } from "./actions";

export function NovaPrensaForm() {
  const [state, formAction, isPending] = useActionState(criarPrensa, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome"
        name="nome"
        type="text"
        placeholder="ex: Offset 4 cores"
        required
        hint="Os demais custos (hora-máquina, chapas, rodagem...) você ajusta na tela seguinte."
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova prensa"}
      </Button>
    </form>
  );
}
