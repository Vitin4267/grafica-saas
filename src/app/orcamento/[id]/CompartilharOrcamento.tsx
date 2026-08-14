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
        {/* Puramente GET — abrir a página pública pra conferir como o
            cliente vê nunca muda o status (só gerarLinkPublico, a action
            acima, faz isso). "Ver não pode ser enviar": isto é o jeito do
            vendedor olhar sem que isso conte como ter enviado de verdade. */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
        >
          Visualizar como o cliente vê
        </a>
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
      {/* Transparência sobre o efeito colateral: gerar o link aqui também
          marca o orçamento como Enviado (ver gerarLinkPublico), pra liberar
          a resposta do cliente pelo link público. */}
      <p className="text-xs text-slate-400 dark:text-slate-500">
        Isso marca o orçamento como &quot;Enviado&quot;.
      </p>
    </form>
  );
}
