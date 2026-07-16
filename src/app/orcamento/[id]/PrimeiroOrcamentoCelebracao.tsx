"use client";

import { useActionState, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { gerarLinkPublico } from "./actions";
import { CopiarLinkButton } from "./CopiarLinkButton";

// Micro-momento de comemoração mostrado UMA VEZ, só quando a página de
// detalhe é aberta logo após criarOrcamento redirecionar com `?primeiro=1`
// (ver src/app/orcamento/actions.ts — "primeiro" é decidido lá por contagem,
// não por src/lib/onboarding.ts). Convite pra copiar o link público já
// embutido, pra reforçar o próximo passo (mandar pro cliente) no instante
// de maior entusiasmo do usuário.
export function PrimeiroOrcamentoCelebracao({
  orcamentoId,
  linkExistente,
}: {
  orcamentoId: string;
  linkExistente: string | null;
}) {
  const [state, formAction, isPending] = useActionState(gerarLinkPublico, null);
  const [visivel, setVisivel] = useState(false);

  // Mesmo truque de "nasce oculto, entra num frame depois" das outras
  // micro-animações do arquivo (ver CheckAprovadoAnimado em
  // OrcamentoAcoes.tsx) — motion-reduce cancela a transição e o card já
  // nasce no estado final, sem indo-e-vindo.
  useEffect(() => {
    const quadro = requestAnimationFrame(() => setVisivel(true));
    return () => cancelAnimationFrame(quadro);
  }, []);

  const url = state?.ok ? state.url : linkExistente;

  return (
    <div
      className={`mb-6 flex flex-col gap-3 rounded-2xl border border-teal-200 bg-teal-50/70 p-5 shadow-sm transition-all duration-300 ease-out motion-reduce:transition-none motion-reduce:translate-y-0 motion-reduce:opacity-100 dark:border-teal-900 dark:bg-teal-950/30 ${
        visivel ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
      }`}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-xl" aria-hidden>
          🎉
        </span>
        <p className="font-semibold text-slate-900 dark:text-white">
          Seu primeiro orçamento foi criado!
        </p>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Envie o link para o cliente aprovar direto pelo celular, sem precisar de conta.
      </p>

      {url ? (
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url}
            className="min-w-0 flex-1 truncate rounded-lg border border-teal-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-teal-900 dark:bg-slate-900 dark:text-slate-300"
          />
          <CopiarLinkButton valor={url} label="Copiar link" />
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="orcamentoId" value={orcamentoId} />
          {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
          <Button type="submit" variant="outline" loading={isPending} className="w-fit">
            Gerar link para compartilhar
          </Button>
        </form>
      )}
    </div>
  );
}
