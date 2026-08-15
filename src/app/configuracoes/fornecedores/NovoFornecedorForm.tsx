"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarFornecedor } from "./actions";

export function NovoFornecedorForm() {
  const [state, formAction, isPending] = useActionState(criarFornecedor, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome"
        name="nome"
        type="text"
        placeholder="ex: Arclad"
        required
      />
      <Input
        label="Contato (opcional)"
        name="contato"
        type="text"
        placeholder="ex: telefone, e-mail ou observação"
        hint="Os demais ajustes (ativo/inativo) você faz na tela seguinte."
      />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Novo fornecedor"}
      </Button>
    </form>
  );
}
