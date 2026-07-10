"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { responderOrcamentoPublico } from "./actions";

export function RespostaPublica({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(responderOrcamentoPublico, null);
  const [confirmandoRecusa, setConfirmandoRecusa] = useState(false);

  if (state?.ok) {
    return <Alert variant="success">{state.mensagem}</Alert>;
  }

  return (
    <div className="flex flex-col gap-3">
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

      {!confirmandoRecusa ? (
        <div className="flex gap-3">
          <form action={formAction}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="decisao" value="APROVADO" />
            <Button type="submit" loading={isPending}>
              Aprovar orçamento
            </Button>
          </form>
          <Button type="button" variant="outline" onClick={() => setConfirmandoRecusa(true)}>
            Recusar
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Alert variant="error">Tem certeza que quer recusar este orçamento?</Alert>
          <div className="flex gap-3">
            <form action={formAction}>
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="decisao" value="REJEITADO" />
              <Button type="submit" variant="secondary" loading={isPending}>
                Confirmar recusa
              </Button>
            </form>
            <Button type="button" variant="ghost" onClick={() => setConfirmandoRecusa(false)}>
              Voltar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
