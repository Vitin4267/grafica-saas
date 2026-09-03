"use client";

import { useActionState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import type { StatusPedido } from "@/generated/prisma/enums";
import { salvarEtapasGrafica } from "./actions";

export type EtapaGraficaLinha = {
  status: StatusPedido;
  rotuloPadrao: string;
  ativa: boolean;
  rotuloCustom: string | null;
  ordem: number;
  // ARTE/PRODUCAO/ENTREGUE — nunca podem ser desativadas (ver
  // ETAPAS_SEMPRE_ATIVAS em src/lib/etapa-grafica.ts).
  sempreAtiva: boolean;
};

export function EtapasProducaoForm({
  etapas,
  podeEditar,
}: {
  etapas: EtapaGraficaLinha[];
  podeEditar: boolean;
}) {
  const [state, formAction, isPending] = useActionState(salvarEtapasGrafica, null);

  return (
    <Card className="p-6">
      <form action={formAction} className="flex flex-col gap-5">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                <th scope="col" className="pb-3 text-left text-xs font-medium text-slate-500">
                  Etapa
                </th>
                <th scope="col" className="pb-3 text-center text-xs font-medium text-slate-500">
                  Ativa
                </th>
                <th scope="col" className="pb-3 text-left text-xs font-medium text-slate-500">
                  Rótulo customizado
                </th>
                <th scope="col" className="w-20 pb-3 text-center text-xs font-medium text-slate-500">
                  Ordem
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {etapas.map((etapa) => (
                <tr key={etapa.status}>
                  <td className="py-3 pr-3">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {etapa.rotuloPadrao}
                    </span>
                    {etapa.sempreAtiva && (
                      <span className="ml-1.5 inline-flex items-center align-middle">
                        <CampoAjuda texto="Esta etapa nunca pode ser desativada — o sistema depende dela pra funcionar (criação de pedido, baixa de estoque ou marcação de entrega)." />
                      </span>
                    )}
                  </td>
                  <td className="py-3 text-center">
                    <input
                      type="checkbox"
                      name={`ativa_${etapa.status}`}
                      defaultChecked={etapa.ativa}
                      disabled={etapa.sempreAtiva || !podeEditar}
                      aria-label={`${etapa.rotuloPadrao} ativa`}
                      className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500 disabled:opacity-50"
                    />
                  </td>
                  <td className="py-3 pr-3">
                    <input
                      type="text"
                      name={`rotulo_${etapa.status}`}
                      defaultValue={etapa.rotuloCustom ?? ""}
                      placeholder={etapa.rotuloPadrao}
                      disabled={!podeEditar}
                      aria-label={`Rótulo customizado para ${etapa.rotuloPadrao}`}
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </td>
                  <td className="py-3">
                    <input
                      type="number"
                      name={`ordem_${etapa.status}`}
                      defaultValue={etapa.ordem}
                      disabled={!podeEditar}
                      aria-label={`Ordem de ${etapa.rotuloPadrao}`}
                      className="w-16 rounded-lg border border-slate-300 px-2 py-1.5 text-center text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        {podeEditar && (
          <Button type="submit" loading={isPending} className="self-start">
            {isPending ? "Salvando..." : "Salvar etapas"}
          </Button>
        )}
      </form>
    </Card>
  );
}
