"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { salvarQuantidadePorEmbalagem } from "./actions";

// Puramente informativo — não muda como estoque é lançado (entrada, saída,
// ajuste), só cadastra um fator de conversão fixo pra mostrar quantas peças
// individuais o estoque cadastrado representa (ex: 1 pacote = 500 etiquetas).
export function QuantidadePorEmbalagemForm({
  itemGraficaId,
  unidadeRotulo,
  valorAtual,
}: {
  itemGraficaId: string;
  unidadeRotulo: string;
  valorAtual: string;
}) {
  const [state, formAction, isPending] = useActionState(salvarQuantidadePorEmbalagem, null);

  return (
    <Card className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Conversão de unidades
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Opcional — só pra exibição. Não muda como entrada, saída ou ajuste de estoque são
          lançados; o estoque continua controlado na unidade cadastrada.
        </p>
      </div>
      <form action={formAction} className="flex items-end gap-3">
        <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
        <div className="w-64">
          <Input
            label={`Quantas unidades tem em cada ${unidadeRotulo || "unidade cadastrada"}? (opcional)`}
            name="quantidadePorEmbalagem"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={valorAtual}
          />
        </div>
        <Button type="submit" variant="outline" loading={isPending}>
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
      </form>
      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
    </Card>
  );
}
