"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarTransportadora } from "./actions";

export function NovaTransportadoraForm() {
  const [state, formAction, isPending] = useActionState(criarTransportadora, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome"
        name="nome"
        type="text"
        placeholder="ex: Lalamove, Jadlog, transportadora própria..."
        required
      />
      <Input label="Telefone (opcional)" name="telefone" type="text" placeholder="ex: (11) 91234-5678" />
      <Input
        label="E-mail (opcional)"
        name="email"
        type="email"
        placeholder="ex: contato@transportadora.com"
        hint="Os demais ajustes (documento, RNTRC, ativa/inativa) você faz na tela seguinte."
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova transportadora"}
      </Button>
    </form>
  );
}
