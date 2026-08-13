"use client";

import { useActionState } from "react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import {
  ETAPAS_ORCAMENTO,
  nomeCampoEtapaEm,
  nomeCampoEtapaResponsavel,
  type ChaveEtapaOrcamento,
} from "@/lib/orcamento-etapas";
import { dataHoraParaInputValue } from "@/lib/data";
import { editarEtapasOrcamento } from "./actions";

type ValoresEtapas = Record<ChaveEtapaOrcamento, { em: Date | null; responsavel: string | null }>;

// As 5 etapas de produção, editáveis direto (não é log de eventos) — a
// qualquer status do orçamento, já que a maioria só faz sentido depois de
// RASCUNHO mesmo (ver editarEtapasOrcamento, actions.ts).
export function EtapasOrcamentoForm({
  orcamentoId,
  valores,
}: {
  orcamentoId: string;
  valores: ValoresEtapas;
}) {
  const [state, formAction, isPending] = useActionState(editarEtapasOrcamento, null);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="orcamentoId" value={orcamentoId} />
      <div className="flex flex-col gap-3">
        {ETAPAS_ORCAMENTO.map(({ chave, rotulo }) => {
          const valor = valores[chave];
          return (
            <div
              key={chave}
              className="grid grid-cols-1 items-end gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-[1fr_1fr_1fr]"
            >
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200 sm:self-center">
                {rotulo}
              </span>
              <Input
                label="Responsável"
                name={nomeCampoEtapaResponsavel(chave)}
                defaultValue={valor?.responsavel ?? ""}
              />
              <Input
                label="Data/hora"
                type="datetime-local"
                name={nomeCampoEtapaEm(chave)}
                defaultValue={valor?.em ? dataHoraParaInputValue(valor.em) : ""}
              />
            </div>
          );
        })}
      </div>
      <Button type="submit" variant="outline" loading={isPending} className="self-start">
        {isPending ? "Salvando..." : "Salvar etapas"}
      </Button>
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
    </form>
  );
}
