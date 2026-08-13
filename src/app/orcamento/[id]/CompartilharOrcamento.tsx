"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { linkWhatsApp } from "@/lib/telefone";
import { gerarLinkPublico, revogarLinkPublico } from "./actions";
import { CopiarLinkButton } from "./CopiarLinkButton";

export function CompartilharOrcamento({
  orcamentoId,
  linkExistente,
  clienteNome,
  clienteTelefone,
  graficaNome,
}: {
  orcamentoId: string;
  linkExistente: string | null;
  clienteNome: string;
  clienteTelefone: string | null;
  graficaNome: string;
}) {
  const [state, formAction, isPending] = useActionState(gerarLinkPublico, null);
  const [revogarState, revogarAction, isRevogando] = useActionState(revogarLinkPublico, null);

  const foiRevogado = revogarState?.ok === true;
  const url = foiRevogado ? null : state?.ok ? state.url : linkExistente;

  if (url) {
    const urlWhatsApp = linkWhatsApp(
      clienteTelefone,
      `Olá ${clienteNome}! Segue o orçamento da ${graficaNome}: ${url}`
    );

    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <input
            readOnly
            value={url}
            className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-300"
          />
          <CopiarLinkButton valor={url} />
        </div>
        {urlWhatsApp ? (
          <a href={urlWhatsApp} target="_blank" rel="noopener noreferrer">
            <Button type="button" variant="primary" className="w-full sm:w-auto">
              Enviar no WhatsApp
            </Button>
          </a>
        ) : (
          <p className="text-xs text-slate-500">
            Cadastre o telefone do cliente em{" "}
            <Link href="/clientes" className="underline">
              Clientes
            </Link>{" "}
            pra habilitar o envio direto por WhatsApp.
          </p>
        )}
        <form action={revogarAction} className="self-start">
          <input type="hidden" name="orcamentoId" value={orcamentoId} />
          <button
            type="submit"
            disabled={isRevogando}
            onClick={(evento) => {
              if (!confirm("Revogar este link? Quem já tem o link atual perde o acesso.")) {
                evento.preventDefault();
              }
            }}
            className="text-xs text-slate-400 underline decoration-dotted underline-offset-2 hover:text-red-600 disabled:opacity-50 dark:text-slate-500 dark:hover:text-red-400"
          >
            {isRevogando ? "Revogando..." : "Revogar link"}
          </button>
        </form>
        {revogarState && !revogarState.ok && <Alert variant="error">{revogarState.mensagem}</Alert>}
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="orcamentoId" value={orcamentoId} />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" variant="outline" loading={isPending}>
        Gerar link para o cliente
      </Button>
    </form>
  );
}
