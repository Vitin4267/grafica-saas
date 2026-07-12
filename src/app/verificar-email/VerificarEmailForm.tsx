"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { logout } from "@/app/logout/actions";
import { verificarCodigo, reenviarCodigo } from "./actions";

export function VerificarEmailForm() {
  const [state, formAction, isPending] = useActionState(verificarCodigo, null);
  const [reenvioState, reenviarAction, reenviando] = useActionState(reenviarCodigo, null);

  return (
    <div className="flex flex-col gap-5">
      <form action={formAction} className="flex flex-col gap-5">
        <label htmlFor="codigo" className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
            Código de 6 dígitos
          </span>
          <input
            id="codigo"
            name="codigo"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            placeholder="000000"
            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-center font-mono text-2xl tracking-[0.5em] text-slate-900 placeholder:tracking-normal placeholder:text-base placeholder:text-slate-400 transition-shadow focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          />
        </label>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="w-full">
          {isPending ? "Confirmando..." : "Confirmar"}
        </Button>
      </form>

      <form action={reenviarAction} className="flex flex-col gap-3">
        {reenvioState && (
          <Alert variant={reenvioState.ok ? "success" : "error"}>{reenvioState.mensagem}</Alert>
        )}
        <Button type="submit" variant="outline" loading={reenviando} className="w-full">
          {reenviando ? "Enviando..." : "Reenviar código"}
        </Button>
      </form>

      <form action={logout}>
        <button
          type="submit"
          className="w-full text-center text-sm text-slate-500 hover:underline dark:text-slate-400"
        >
          Sair e usar outra conta
        </button>
      </form>
    </div>
  );
}
