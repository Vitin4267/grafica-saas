"use client";

import { useActionState } from "react";
import { alternarItemPedidoConcluido } from "./item-pedido-status-actions";

// Achado F3 da auditoria de abrangência (2026-09-14, escopo reduzido) —
// mesmo padrão auto-salva de PrioridadePedidoSeletor.tsx (sem botão
// "Salvar" separado, submit no onChange). Marcador só visual/paralelo —
// nunca bloqueia nem acelera o avanço do Pedido inteiro, ver comentário
// completo no model ItemPedidoStatus.
export function ItemPedidoStatusCheckbox({
  pedidoId,
  orcamentoItemId,
  concluidoInicial,
}: {
  pedidoId: string;
  orcamentoItemId: string;
  concluidoInicial: boolean;
}) {
  const [state, formAction, isPending] = useActionState(alternarItemPedidoConcluido, null);

  return (
    <form action={formAction} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="pedidoId" value={pedidoId} />
      <input type="hidden" name="orcamentoItemId" value={orcamentoItemId} />
      <label className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <input
          type="checkbox"
          name="concluido"
          defaultChecked={concluidoInicial}
          disabled={isPending}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="h-3.5 w-3.5 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
        />
        pronto
      </label>
      {state && !state.ok && <span className="text-xs text-rose-600">{state.mensagem}</span>}
    </form>
  );
}
