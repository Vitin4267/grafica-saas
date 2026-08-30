"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { salvarConfiguracaoEmenda } from "./actions";

export function ConfiguracaoEmendaForm({
  itemGraficaId,
  configuracao,
}: {
  itemGraficaId: string;
  configuracao: { custoPorMetroLinear: string; sobreposicaoM: string } | null;
}) {
  const [state, formAction, isPending] = useActionState(salvarConfiguracaoEmenda, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
      <Card className="flex flex-col gap-5 p-6">
        <Alert variant={configuracao ? "success" : "info"}>
          {configuracao
            ? "Emenda de painéis ligada — quando a peça for maior que todas as bobinas cadastradas, o orçamento calcula o custo de emenda em vez de bloquear."
            : "Emenda de painéis desligada — cadastre um custo abaixo pra ligar. Sem isso, uma peça maior que todas as bobinas cadastradas continua bloqueando o orçamento (comportamento de hoje). Útil pra backdrop, fachada, outdoor e painel de evento, onde emendar painéis é rotina."}
        </Alert>

        <Input
          label="Custo da emenda por metro linear (R$)"
          name="custoPorMetroLinear"
          type="number"
          step="0.0001"
          min="0"
          required
          defaultValue={configuracao?.custoPorMetroLinear ?? ""}
          hint="Multiplicado pelo comprimento de cada emenda e pelo nº de emendas necessárias — cobre a solda/costura entre os painéis."
        />

        <Input
          label="Sobreposição recomendada por emenda (m)"
          name="sobreposicaoM"
          type="number"
          step="0.001"
          min="0"
          required
          defaultValue={configuracao?.sobreposicaoM ?? ""}
          hint="Só informativo — aparece no aviso do orçamento pra produção/instalação saberem quanto de sobra deixar em cada emenda. Não entra no cálculo do preço."
        />

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar configuração"}
        </Button>
      </Card>
    </form>
  );
}
