"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { avancarStatusQr } from "./actions";

// Botão único, grande, pensado pra ser tocado com o dedo no chão de fábrica
// (celular do operador, possivelmente com luva) — ao contrário de
// ConfirmarEstagioPublico (src/app/p/[token]/ConfirmarEstagioPublico.tsx),
// não recebe etapaEsperada: a etiqueta física não fica "presa" a uma etapa
// específica como um e-mail antigo ficaria, ela é reescaneada a cada nova
// etapa do mesmo pedido.
export function AvancarStatusQr({
  token,
  rotuloProximaEtapa,
}: {
  token: string;
  rotuloProximaEtapa: string;
}) {
  const [state, formAction, isPending] = useActionState(avancarStatusQr, null);

  if (state?.ok) {
    return <Alert variant="success">{state.mensagem}</Alert>;
  }

  return (
    <div className="flex flex-col gap-3">
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <form action={formAction}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" loading={isPending} className="w-full py-6 text-lg">
          Avançar para {rotuloProximaEtapa}
        </Button>
      </form>
    </div>
  );
}
