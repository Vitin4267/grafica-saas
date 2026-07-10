"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { UserIcon, MailIcon } from "@/components/icons";
import { criarUsuario } from "./actions";

export function UsuarioForm() {
  const [state, formAction, isPending] = useActionState(criarUsuario, null);
  const [resetKey, setResetKey] = useState(0);
  const [estadoAnterior, setEstadoAnterior] = useState(state);

  // Mesmo padrão de reset pós-sucesso do ClienteForm — form de criar-novo-
  // registro, precisa limpar os campos não-controlados depois de cada envio.
  if (state !== estadoAnterior) {
    setEstadoAnterior(state);
    if (state?.ok) setResetKey((k) => k + 1);
  }

  return (
    <form key={resetKey} action={formAction} className="flex flex-col gap-4">
      <Input label="Nome" name="nome" required icon={<UserIcon className="h-4 w-4" />} />
      <Input
        label="E-mail"
        name="email"
        type="email"
        required
        icon={<MailIcon className="h-4 w-4" />}
      />
      <PasswordInput
        label="Senha inicial"
        name="senha"
        required
        minLength={10}
        hint="Mínimo 10 caracteres, com letra maiúscula, minúscula e número."
      />
      <Select label="Papel" name="papel" required defaultValue="OPERADOR">
        <option value="OPERADOR">Operador</option>
        <option value="ADMIN">Administrador</option>
      </Select>

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "Criar usuário"}
      </Button>
    </form>
  );
}
