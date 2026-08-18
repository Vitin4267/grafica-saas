"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { salvarConfiguracaoClicheEtiqueta } from "./actions";

export function ConfiguracaoClicheEtiquetaForm({
  itemGraficaId,
  configuracao,
}: {
  itemGraficaId: string;
  configuracao: { custoClichePorCm2: string } | null;
}) {
  const [state, formAction, isPending] = useActionState(salvarConfiguracaoClicheEtiqueta, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
      <Card className="flex flex-col gap-5 p-6">
        <Alert variant="success">
          {configuracao
            ? "Motor de clichê ligado — na hora de montar um orçamento com este produto, o vendedor escolhe o papel (matéria-prima) e a quantidade de cores."
            : "Motor de clichê desligado — cadastre um custo abaixo pra ligar. Sem isso, este produto usa preço normal (custo de compra do próprio item)."}
        </Alert>

        <Input
          label="Custo do clichê por cm² (R$)"
          name="custoClichePorCm2"
          type="number"
          step="0.0001"
          min="0"
          required
          defaultValue={configuracao?.custoClichePorCm2 ?? ""}
          hint="Multiplicado pela área da etiqueta e pelo nº de cores do orçamento — não escala com a quantidade impressa, só com tamanho e nº de cores (mesma lógica de uma chapa offset, só que por área)."
        />

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar configuração"}
        </Button>
      </Card>
    </form>
  );
}
