"use client";

import { useActionState } from "react";
import { salvarPerfilUsuario } from "./actions";

type PerfilOpcao = { id: string; nome: string };

// Achado A5 da auditoria de abrangência (Parte 6/Configurações,
// pesquisa-abrangencia-modulos.md, 2026-08-27) — cargos de acesso por linha
// de OPERADOR em /usuarios, ao lado do link "Permissões" (override
// individual). Feature "multi-cargo" (2026-09-06): virou checkbox múltiplo
// (era um <select> de valor único) — um usuário pode ter vários cargos ao
// mesmo tempo (ex: Vendedor E Financeiro). Auto-salva no onChange de
// QUALQUER checkbox (mesmo espírito de instantâneo dos botões Remover/
// Reativar da lista) em vez de exigir um botão "Salvar" separado — é um
// componente próprio (não inline no .map de UsuariosLista) porque cada
// linha precisa do próprio useActionState.
export function PerfilAcessoCell({
  usuarioId,
  perfilAcessoIdsAtuais,
  perfis,
}: {
  usuarioId: string;
  perfilAcessoIdsAtuais: string[];
  perfis: PerfilOpcao[];
}) {
  const [state, formAction, isPending] = useActionState(salvarPerfilUsuario, null);

  const nomesAtuais = perfis
    .filter((p) => perfilAcessoIdsAtuais.includes(p.id))
    .map((p) => p.nome);
  const rotuloResumo = nomesAtuais.length > 0 ? nomesAtuais.join(", ") : "Sem cargo";

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name="usuarioId" value={usuarioId} />
      <details className="group relative">
        <summary
          className="cursor-pointer select-none list-none rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 marker:content-none hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
          title="Clique pra escolher os cargos deste usuário"
        >
          {rotuloResumo}
        </summary>
        <div className="absolute right-0 z-10 mt-1 flex w-56 flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900">
          {perfis.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200"
            >
              <input
                type="checkbox"
                name="perfilAcessoId"
                value={p.id}
                defaultChecked={perfilAcessoIdsAtuais.includes(p.id)}
                disabled={isPending}
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              {p.nome}
            </label>
          ))}
        </div>
      </details>
      {state && !state.ok && <span className="text-xs text-rose-600">{state.mensagem}</span>}
    </form>
  );
}
