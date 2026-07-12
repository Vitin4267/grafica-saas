"use client";

import { useActionState } from "react";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { redefinirSenha } from "./actions";

export function RedefinirSenhaForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(redefinirSenha, null);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="token" value={token} />

      <PasswordInput
        label="Nova senha"
        name="senha"
        required
        autoComplete="new-password"
        minLength={10}
        hint="Mínimo 10 caracteres, com letra maiúscula, minúscula e número."
      />

      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="w-full">
        {isPending ? "Salvando..." : "Redefinir senha"}
      </Button>
    </form>
  );
}
