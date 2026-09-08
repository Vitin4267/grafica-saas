"use client";

import { useActionState } from "react";
import { NIVEIS_PRIORIDADE_PEDIDO } from "@/lib/prioridade-pedido";
import { alterarPrioridadePedido } from "./actions";

// Achado C1 da Parte 2 (Produção) da auditoria de abrangência
// (pesquisa-abrangencia-modulos.md, 2026-09-07) — editor de
// Pedido.prioridade na lista de produção. <select> com 4 rótulos fixos em
// vez de drag-and-drop chique ou input numérico livre: decisão de UX
// (público leigo, princípio já estabelecido no projeto) — "arraste pra
// reordenar" é complexo de construir bem e "quanto maior o número, mais
// prioritário" não é intuitivo pra quem opera a gráfica no dia a dia.
// Auto-salva no onChange (mesmo padrão instantâneo de PerfilAcessoCell.tsx
// em /usuarios, sem exigir um botão "Salvar" separado).
export function PrioridadePedidoSeletor({
  pedidoId,
  prioridade,
}: {
  pedidoId: string;
  prioridade: number;
}) {
  const [state, formAction, isPending] = useActionState(alterarPrioridadePedido, null);

  return (
    <form action={formAction} className="flex items-center gap-1.5">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <label className="sr-only" htmlFor={`prioridade-${pedidoId}`}>
        Prioridade do pedido
      </label>
      <select
        id={`prioridade-${pedidoId}`}
        name="prioridade"
        defaultValue={prioridade}
        disabled={isPending}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600 focus:border-teal-500 focus:outline-none disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
      >
        {NIVEIS_PRIORIDADE_PEDIDO.map((nivel) => (
          <option key={nivel.valor} value={nivel.valor}>
            Prioridade: {nivel.rotulo}
          </option>
        ))}
      </select>
      {state && !state.ok && <span className="text-xs text-rose-600">{state.mensagem}</span>}
    </form>
  );
}
