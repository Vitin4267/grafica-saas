"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { responderArtePublica } from "./actions";

export function RespostaArtePublica({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(responderArtePublica, null);
  const [pedindoAlteracao, setPedindoAlteracao] = useState(false);

  if (state?.ok) {
    return <Alert variant="success">{state.mensagem}</Alert>;
  }

  return (
    <div className="flex flex-col gap-3">
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

      {!pedindoAlteracao ? (
        <div className="flex gap-3">
          <form action={formAction}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="decisao" value="APROVADA" />
            <Button type="submit" loading={isPending}>
              Aprovar arte
            </Button>
          </form>
          <Button type="button" variant="outline" onClick={() => setPedindoAlteracao(true)}>
            Pedir alteração
          </Button>
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="decisao" value="ALTERACAO" />
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              O que precisa mudar?
            </span>
            <textarea
              name="comentario"
              rows={4}
              required
              maxLength={2000}
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              placeholder="Ex: a cor do fundo devia ser azul, não verde"
            />
          </label>
          <div className="flex gap-3">
            <Button type="submit" variant="secondary" loading={isPending}>
              Enviar pedido de alteração
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPedindoAlteracao(false)}>
              Voltar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
