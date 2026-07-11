"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { BuildingIcon, MailIcon, UserIcon } from "@/components/icons";
import { registrar } from "./actions";

export function RegistroForm() {
  const [state, formAction, isPending] = useActionState(registrar, null);

  return (
    <form action={formAction} className="flex flex-col gap-5">
      {/* Honeypot anti-bot: invisível pra gente, mas formulários preenchidos
          automaticamente por bots costumam preencher todo campo que encontram. */}
      <input
        type="text"
        name="site"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <Input
        label="Nome da gráfica"
        name="graficaNome"
        required
        placeholder="Ex: Gráfica São José"
        icon={<BuildingIcon className="h-4 w-4" />}
      />

      <Input
        label="Seu nome"
        name="nome"
        required
        autoComplete="name"
        placeholder="Como podemos te chamar"
        icon={<UserIcon className="h-4 w-4" />}
      />

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
        autoComplete="new-password"
        minLength={10}
        hint="Mínimo 10 caracteres, com letra maiúscula, minúscula e número."
      />

      <label className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
        <input
          type="checkbox"
          name="aceiteTermos"
          required
          className="mt-0.5 h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        <span>
          Li e concordo com os{" "}
          <Link href="/termos" target="_blank" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
            Termos de Uso
          </Link>{" "}
          e a{" "}
          <Link href="/privacidade" target="_blank" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
            Política de Privacidade
          </Link>
          .
        </span>
      </label>

      {state && !state.ok && <Alert>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="w-full">
        {isPending ? "Criando conta..." : "Criar conta grátis"}
      </Button>

      <p className="text-center text-sm text-slate-500">
        Já tem conta?{" "}
        <Link href="/login" className="font-medium text-teal-700 hover:underline dark:text-teal-400">
          Entrar
        </Link>
      </p>
    </form>
  );
}
