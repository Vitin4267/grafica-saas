"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarMaquinaFlexografia } from "./actions";

export function NovaMaquinaFlexografiaForm() {
  const [state, formAction, isPending] = useActionState(criarMaquinaFlexografia, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome"
        name="nome"
        type="text"
        placeholder="ex: Flexo 6 cores"
        required
        hint="Os demais custos (hora-máquina, rodagem, acerto...) você ajusta na tela seguinte."
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova máquina"}
      </Button>
    </form>
  );
}
