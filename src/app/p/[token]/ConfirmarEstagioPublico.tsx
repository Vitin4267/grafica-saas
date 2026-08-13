"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { confirmarEstagioPublico } from "./actions";

// Frase de confirmação por etapa — "Confirmar {rotulo.toLowerCase()} pronta"
// soava natural só pra Impressão ("confirmar impressão pronta"); nas outras
// duas dava "confirmar acabamento pronta" (concordância errada) e "confirmar
// pronto pronta" (redundante/sem sentido, já que o rótulo da etapa PRONTO já
// é "Pronto"). Chaveado pelo rótulo (e não pelo StatusPedido) porque é só o
// que esse componente recebe de page.tsx — os 3 valores vêm de
// ESTAGIOS_ATRIBUIVEIS em producao-estagios.ts. Fallback genérico cobre uma
// eventual etapa nova sem quebrar a build.
const FRASES_CONFIRMACAO: Record<string, string> = {
  Impressão: "Confirmar impressão concluída",
  Acabamento: "Confirmar acabamento concluído",
  Pronto: "Confirmar pedido pronto",
};

export function ConfirmarEstagioPublico({
  token,
  rotuloEtapa,
  etapaEsperada,
}: {
  token: string;
  rotuloEtapa: string;
  // Status do pedido no momento em que a página foi renderizada — a action
  // confere isso contra o status ATUAL antes de avançar, pra um e-mail
  // antigo (de uma etapa que já passou) não conseguir empurrar o pedido a
  // partir de onde ele está agora. Ver confirmarEstagioPublico em ./actions.ts.
  etapaEsperada: string;
}) {
  const [state, formAction, isPending] = useActionState(confirmarEstagioPublico, null);

  if (state?.ok) {
    return <Alert variant="success">{state.mensagem}</Alert>;
  }

  return (
    <div className="flex flex-col gap-3">
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <form action={formAction}>
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="etapaEsperada" value={etapaEsperada} />
        <Button type="submit" loading={isPending}>
          {FRASES_CONFIRMACAO[rotuloEtapa] ?? `Confirmar ${rotuloEtapa.toLowerCase()}`}
        </Button>
      </form>
    </div>
  );
}
