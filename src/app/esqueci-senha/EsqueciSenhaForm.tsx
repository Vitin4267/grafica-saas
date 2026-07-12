"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { MailIcon } from "@/components/icons";
import { solicitarResetSenha } from "./actions";

export function EsqueciSenhaForm() {
  const [state, formAction, isPending] = useActionState(solicitarResetSenha, null);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <Input
        label="E-mail"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="voce@suagrafica.com.br"
        icon={<MailIcon className="h-4 w-4" />}
      />

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="w-full">
        {isPending ? "Enviando..." : "Enviar link de redefinição"}
      </Button>

      <p className="text-center text-sm text-slate-500">
        Lembrou a senha?{" "}
        <Link href="/login" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
          Voltar pro login
        </Link>
      </p>
    </form>
  );
}
