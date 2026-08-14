"use client";

import { useActionState } from "react";
import { reordenarCategoriasCusto } from "./actions";

// Reordenação simples por botões (não drag-and-drop) — cada botão já
// carrega no form a lista COMPLETA de ids na nova ordem desejada, calculada
// em page.tsx (server) a partir da posição atual da categoria na lista.
// `idsSubir`/`idsDescer` vêm null quando o movimento não se aplica (já é a
// primeira/última), o que desabilita o botão sem precisar de outra prop.
export function CategoriaCustoOrdemBotoes({
  idsSubir,
  idsDescer,
}: {
  idsSubir: string[] | null;
  idsDescer: string[] | null;
}) {
  const [, subirAction, subindoPending] = useActionState(reordenarCategoriasCusto, null);
  const [, descerAction, descendoPending] = useActionState(reordenarCategoriasCusto, null);

  return (
    <div className="flex flex-col">
      <form action={subirAction}>
        {idsSubir?.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
        <button
          type="submit"
          disabled={!idsSubir || subindoPending}
          aria-label="Mover categoria para cima"
          title="Mover para cima"
          className="flex h-5 w-5 items-center justify-center text-[10px] leading-none text-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:text-slate-200"
        >
          ▲
        </button>
      </form>
      <form action={descerAction}>
        {idsDescer?.map((id) => <input key={id} type="hidden" name="ids" value={id} />)}
        <button
          type="submit"
          disabled={!idsDescer || descendoPending}
          aria-label="Mover categoria para baixo"
          title="Mover para baixo"
          className="flex h-5 w-5 items-center justify-center text-[10px] leading-none text-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:text-slate-200"
        >
          ▼
        </button>
      </form>
    </div>
  );
}
