"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { UserIcon, MailIcon } from "@/components/icons";
import { criarCliente } from "./actions";
import { EnderecoFields, ENDERECO_VAZIO } from "./EnderecoFields";

export function ClienteForm() {
  const [state, formAction, isPending] = useActionState(criarCliente, null);
  const [resetKey, setResetKey] = useState(0);
  const [estadoAnterior, setEstadoAnterior] = useState(state);

  // Reseta o form (campos não-controlados) após um cadastro bem-sucedido,
  // seguindo o padrão de "ajustar estado durante a renderização" do React
  // (evita useEffect só para reagir a uma mudança de prop/state).
  if (state !== estadoAnterior) {
    setEstadoAnterior(state);
    if (state?.ok) setResetKey((k) => k + 1);
  }

  return (
    <form key={resetKey} action={formAction} className="flex flex-col gap-4">
      <Input label="Nome" name="nome" required icon={<UserIcon className="h-4 w-4" />} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="E-mail" name="email" type="email" icon={<MailIcon className="h-4 w-4" />} />
        <Input label="Telefone" name="telefone" placeholder="(00) 00000-0000" />
      </div>
      <Input label="CPF/CNPJ" name="documento" placeholder="opcional" />

      <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
        <p className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
          Endereço <span className="font-normal text-slate-400">(opcional — necessário só pra emitir nota fiscal)</span>
        </p>
        <EnderecoFields valoresIniciais={ENDERECO_VAZIO} />
      </div>

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Cadastrar cliente"}
      </Button>
    </form>
  );
}
