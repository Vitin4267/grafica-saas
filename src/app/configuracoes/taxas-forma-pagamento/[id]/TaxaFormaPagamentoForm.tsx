"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { editarTaxaFormaPagamento, alternarAtivaTaxaFormaPagamento } from "../actions";

export function TaxaFormaPagamentoForm({
  taxaId,
  percentual,
  diasCompensacao,
  ativa,
}: {
  taxaId: string;
  percentual: string;
  diasCompensacao: number;
  ativa: boolean;
}) {
  const [state, formAction, isPending] = useActionState(editarTaxaFormaPagamento, null);
  const [estadoAtiva, alternarAction, alternandoPending] = useActionState(
    alternarAtivaTaxaFormaPagamento,
    null
  );

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="taxaId" value={taxaId} />
        <Card className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Taxa (%)"
              name="percentual"
              type="number"
              step="0.01"
              min="0"
              defaultValue={percentual}
            />
            <Input
              label="Dias até compensar"
              name="diasCompensacao"
              type="number"
              step="1"
              min="0"
              defaultValue={diasCompensacao}
            />
          </div>
        </Card>
        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar taxa"}
        </Button>
      </form>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {ativa ? "Taxa ativa" : "Taxa inativa"}
          </p>
          <p className="text-xs text-slate-500">
            {ativa
              ? "Pré-preenche o valor da taxa ao escolher esta forma de pagamento num registro novo."
              : "Some da seleção de pré-preenchimento, mas nenhum pagamento já registrado é alterado. Nunca é excluída de verdade."}
          </p>
          {estadoAtiva && !estadoAtiva.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoAtiva.mensagem}</p>
          )}
        </div>
        <form action={alternarAction}>
          <input type="hidden" name="taxaId" value={taxaId} />
          <Button type="submit" variant="outline" loading={alternandoPending} className="shrink-0">
            {ativa ? "Desativar" : "Ativar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
