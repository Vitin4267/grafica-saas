"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { MailIcon } from "@/components/icons";
import { login } from "./actions";

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(login, null);

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

      <PasswordInput
        label="Senha"
        name="senha"
        required
        autoComplete="current-password"
      />

      {state && !state.ok && <Alert>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="w-full">
        {isPending ? "Entrando..." : "Entrar"}
      </Button>

      <p className="text-center text-sm text-slate-500">
        Ainda não tem conta?{" "}
        <Link href="/registro" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
          Cadastre sua gráfica
        </Link>
      </p>
    </form>
  );
}
