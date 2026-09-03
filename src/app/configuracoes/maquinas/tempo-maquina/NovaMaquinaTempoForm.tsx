"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarMaquinaTempo } from "./actions";

export function NovaMaquinaTempoForm() {
  const [state, formAction, isPending] = useActionState(criarMaquinaTempo, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome"
        name="nome"
        type="text"
        placeholder="ex: Router CNC MultiCam, Laser CO2 Visutec"
        required
        hint="Os custos (hora de máquina, setup, mínimo, corte) você ajusta na tela seguinte."
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova máquina"}
      </Button>
    </form>
  );
}
