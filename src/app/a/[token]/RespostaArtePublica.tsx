"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { responderArtePublica } from "./actions";

export function RespostaArtePublica({
  token,
  nomeSugerido,
}: {
  token: string;
  // Orcamento.contatoNome do pedido, quando cadastrado — mesmo princípio de
  // pré-preenchimento de o/[token]/RespostaPublica.tsx.
  nomeSugerido: string | null;
}) {
  const [state, formAction, isPending] = useActionState(responderArtePublica, null);
  const [pedindoAlteracao, setPedindoAlteracao] = useState(false);
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

      {!pedindoAlteracao ? (
        <div className="flex gap-3">
          <form action={formAction}>
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="decisao" value="APROVADA" />
            <input type="hidden" name="nome" value={nome} />
            <Button type="submit" loading={isPending} disabled={!nomeValido}>
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
          <input type="hidden" name="nome" value={nome} />
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
            <Button type="submit" variant="secondary" loading={isPending} disabled={!nomeValido}>
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
