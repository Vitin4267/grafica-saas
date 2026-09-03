"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { criarPerfilAcesso } from "./actions";

export function NovoPerfilForm() {
  const [state, formAction, isPending] = useActionState(criarPerfilAcesso, null);
  const [resetKey, setResetKey] = useState(0);
  const [estadoAnterior, setEstadoAnterior] = useState(state);

  // Mesmo padrão de reset pós-sucesso de UsuarioForm — mas como o sucesso
  // aqui redireciona (redirect() em criarPerfilAcesso), isto só teria efeito
  // no caso raro de erro seguido de novo envio; mantido por consistência.
  if (state !== estadoAnterior) {
    setEstadoAnterior(state);
    if (state?.ok) setResetKey((k) => k + 1);
  }

  return (
    <form key={resetKey} action={formAction} className="flex flex-col gap-4">
      <Input
        label="Nome do perfil"
        name="nome"
        required
        placeholder="Ex: Impressor, Acabamento, Vendedor externo"
      />

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "Criar perfil"}
      </Button>
    </form>
  );
}
