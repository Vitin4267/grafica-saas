"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { responderOrcamentoPublico } from "./actions";

export function RespostaPublica({
  token,
  nomeSugerido,
}: {
  token: string;
  // Orcamento.contatoNome, quando cadastrado — pré-preenche o campo pra
  // pessoa só confirmar em vez de digitar, principalmente no caminho de
  // aprovar (é o botão onde atrito custa mais caro). Continua editável: quem
  // está com o link na mão pode não ser o contato cadastrado.
  nomeSugerido: string | null;
}) {
  const [state, formAction, isPending] = useActionState(responderOrcamentoPublico, null);
  const [confirmandoRecusa, setConfirmandoRecusa] = useState(false);
  const [nome, setNome] = useState(nomeSugerido ?? "");

  if (state?.ok) {
    return <Alert variant="success">{state.mensagem}</Alert>;
  }

  const nomeValido = nome.trim().length > 0;

  return (
    <div className="flex flex-col gap-3">
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">Seu nome</span>
        <input
          type="text"
          value={nome}
          onChange={(evento) => setNome(evento.target.value)}
          maxLength={200}
          placeholder="Digite seu nome"
          className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
        />
      </label>

      {!confirmandoRecusa ? (
        <div className="flex gap-3">
          <form action={formAction}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="decisao" value="APROVADO" />
            <input type="hidden" name="nome" value={nome} />
            <Button type="submit" loading={isPending} disabled={!nomeValido}>
              Aprovar orçamento
            </Button>
          </form>
          <Button type="button" variant="outline" onClick={() => setConfirmandoRecusa(true)}>
            Recusar
          </Button>
        </div>
      ) : (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="decisao" value="REJEITADO" />
          <input type="hidden" name="nome" value={nome} />
          <Alert variant="error">Tem certeza que quer recusar este orçamento?</Alert>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Por que está recusando? (opcional)
            </span>
            <textarea
              name="motivo"
              rows={3}
              maxLength={2000}
              placeholder="Ex: o prazo não encaixa, o valor ficou acima do esperado..."
              className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
          </label>
          <div className="flex gap-3">
            <Button type="submit" variant="secondary" loading={isPending} disabled={!nomeValido}>
              Confirmar recusa
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirmandoRecusa(false)}>
              Voltar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
