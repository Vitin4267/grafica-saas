"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { salvarParametros } from "./actions";
import type { ParametrosTenant } from "@/lib/pricing";

export function ParametrosForm({ parametros }: { parametros: ParametrosTenant }) {
  const [state, formAction, isPending] = useActionState(salvarParametros, null);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Composição de preço
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Overhead (%)"
            name="overheadPercent"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.overheadPercent}
            hint="ex: 0.15 = 15% sobre o custo direto"
          />
          <Input
            label="Margem padrão (%)"
            name="margemPadrao"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.margemPadrao}
          />
          <Input
            label="Imposto (%)"
            name="impostoPercent"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.impostoPercent}
          />
          <Input
            label="Comissão (%)"
            name="comissaoPercent"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.comissaoPercent}
          />
          <Input
            label="Taxa financeira (%)"
            name="taxaFinanceiraPercent"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.taxaFinanceiraPercent}
          />
          <Input
            label="Pedido mínimo (R$)"
            name="pedidoMinimo"
            type="number"
            step="0.01"
            min="0"
            defaultValue={parametros.pedidoMinimo}
          />
          <Input
            label="Incremento de arredondamento (R$)"
            name="incrementoArredondamento"
            type="number"
            step="0.01"
            min="0.01"
            defaultValue={parametros.incrementoArredondamento}
            hint="Preço final sempre arredonda para cima nesse múltiplo"
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Prensa offset
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Custo por hora de máquina (R$)"
            name="custoHoraMaq"
            type="number"
            step="0.01"
            min="0"
            defaultValue={parametros.custoHoraMaq}
          />
          <Input
            label="Torres da prensa"
            name="torres"
            type="number"
            step="1"
            min="1"
            defaultValue={parametros.torres}
            hint="Quantas cores por passada de máquina"
          />
          <Input
            label="Custo por chapa (R$)"
            name="custoChapa"
            type="number"
            step="0.01"
            min="0"
            defaultValue={parametros.custoChapa}
          />
          <Input
            label="Folhas de acerto"
            name="folhasAcerto"
            type="number"
            step="1"
            min="0"
            defaultValue={parametros.folhasAcerto}
          />
          <Input
            label="Tempo de acerto (horas)"
            name="tempoAcertoH"
            type="number"
            step="0.01"
            min="0"
            defaultValue={parametros.tempoAcertoH}
          />
          <Input
            label="Custo por milheiro de rodagem (R$)"
            name="custoMilheiroRod"
            type="number"
            step="0.01"
            min="0"
            defaultValue={parametros.custoMilheiroRod}
          />
          <Input
            label="Rodagem mínima (R$)"
            name="rodagemMinima"
            type="number"
            step="0.01"
            min="0"
            defaultValue={parametros.rodagemMinima}
          />
          <Input
            label="Perda padrão (%)"
            name="perdaPercentPadrao"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.perdaPercentPadrao}
          />
        </div>
      </Card>

      <Card className="flex flex-col gap-4 p-6">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Nesting de bobina
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Margem de segurança padrão (%)"
            name="margemSegurancaPadrao"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.margemSegurancaPadrao}
          />
          <Input
            label="Gap entre peças padrão (m)"
            name="gapPecasPadrao"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={parametros.gapPecasPadrao}
          />
        </div>
      </Card>

      {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Salvar parâmetros"}
      </Button>
    </form>
  );
}
