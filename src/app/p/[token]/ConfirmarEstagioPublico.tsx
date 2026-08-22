"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { confirmarEstagioPublico } from "./actions";

// Frase de confirmação por etapa — mesmo raciocínio de
// FRASES_CONFIRMACAO_ESTAGIO em src/lib/email/templates.ts (concordância de
// gênero e sentido variam por rótulo, nunca dá pra interpolar
// genericamente). Chaveado pelo rótulo (e não pelo StatusPedido) porque é só
// o que esse componente recebe de page.tsx — os 5 valores vêm de
// ESTAGIOS_ATRIBUIVEIS em producao-estagios.ts. Fallback genérico cobre uma
// eventual etapa nova sem quebrar a build.
const FRASES_CONFIRMACAO: Record<string, string> = {
  Produção: "Confirmar produção concluída",
  Acabamento: "Confirmar acabamento concluído",
  Conferência: "Confirmar conferência concluída",
  Embalagem: "Confirmar embalagem concluída",
  Expedição: "Confirmar pedido expedido",
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
