"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarMaquinaBordado } from "./actions";

export function NovaMaquinaBordadoForm() {
  const [state, formAction, isPending] = useActionState(criarMaquinaBordado, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome"
        name="nome"
        type="text"
        placeholder="ex: Bordadeira Tajima 6 cabeças"
        required
        hint="Os custos (por mil pontos, matriz, mínimo) você ajusta na tela seguinte."
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova máquina de bordado"}
      </Button>
    </form>
  );
}
