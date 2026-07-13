"use client";

import { useActionState, useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { salvarFilial, excluirFilial } from "../actions";

type ValoresFilial = {
  nome: string;
  endereco: string;
  ativa: boolean;
};

export function FilialForm({
  filialId,
  valoresIniciais,
}: {
  filialId: string;
  valoresIniciais: ValoresFilial;
}) {
  const [state, formAction, isPending] = useActionState(salvarFilial, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(excluirFilial, null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useEffect(() => {
    if (estadoExclusao && !estadoExclusao.ok) setConfirmandoExclusao(false);
  }, [estadoExclusao]);

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-6">
        <input type="hidden" name="filialId" value={filialId} />

        <Card className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Nome" name="nome" type="text" defaultValue={valoresIniciais.nome} required />
            <label className="flex items-center gap-2 self-end pb-2.5">
              <input
                type="checkbox"
                name="ativa"
                defaultChecked={valoresIniciais.ativa}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-slate-700 dark:text-slate-200">
                Filial ativa (aparece pra seleção no orçamento)
              </span>
            </label>
            <div className="sm:col-span-2">
              <Input
                label="Endereço"
                name="endereco"
                type="text"
                defaultValue={valoresIniciais.endereco}
                placeholder="opcional — só referência"
              />
            </div>
          </div>
        </Card>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar filial"}
        </Button>
      </form>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Excluir filial</p>
            <p className="text-xs text-slate-500">
              Orçamentos já feitos nesta filial continuam existindo, só ficam sem filial marcada.
            </p>
            {estadoExclusao && !estadoExclusao.ok && (
              <p className="mt-1 text-xs text-rose-600">{estadoExclusao.mensagem}</p>
            )}
          </div>
          {!confirmandoExclusao && (
            <Button
              type="button"
              variant="outline"
              className="shrink-0 text-rose-600"
              onClick={() => setConfirmandoExclusao(true)}
            >
              Excluir
            </Button>
          )}
        </div>
        {confirmandoExclusao && (
          <ConfirmarExclusao
            pergunta={`Tem certeza que quer excluir a filial "${valoresIniciais.nome}"? Essa ação não pode ser desfeita.`}
            onCancelar={() => setConfirmandoExclusao(false)}
            formAction={excluirAction}
            campos={{ filialId }}
            rotuloBotao="Excluir filial"
            pendente={excluindo}
          />
        )}
      </Card>
    </div>
  );
}
