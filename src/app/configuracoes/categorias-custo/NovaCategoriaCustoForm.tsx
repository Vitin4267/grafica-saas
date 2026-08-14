"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarCategoriaCusto } from "./actions";

export function NovaCategoriaCustoForm() {
  const [state, formAction, isPending] = useActionState(criarCategoriaCusto, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome"
        name="nome"
        type="text"
        placeholder="ex: Papel especial"
        required
        hint="Os demais ajustes (ativa/inativa) você faz na tela seguinte."
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova categoria"}
      </Button>
    </form>
  );
}
