"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { salvarImpressoraDigital, excluirImpressoraDigital } from "../actions";

type ValoresImpressoraDigital = {
  nome: string;
  ativa: boolean;
  custoPorClique: string;
};

export function ImpressoraDigitalForm({
  impressoraId,
  valoresIniciais,
}: {
  impressoraId: string;
  valoresIniciais: ValoresImpressoraDigital;
}) {
  const [state, formAction, isPending] = useActionState(salvarImpressoraDigital, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(
    excluirImpressoraDigital,
    null
  );
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useAoMudar(estadoExclusao, (estadoExclusao) => {
    if (estadoExclusao && !estadoExclusao.ok) setConfirmandoExclusao(false);
  });

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-6">
        <input type="hidden" name="impressoraId" value={impressoraId} />

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
                Impressora ativa (aparece pra seleção no catálogo)
              </span>
            </label>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Custo de máquina
          </h2>
          <Input
            label={
              <>
                Custo por clique (R$)
                <CampoAjuda texto="'Clique' é como o fabricante da impressora cobra pelo uso da máquina — geralmente o valor por página impressa dentro do contrato de manutenção, já incluindo tinta/toner e assistência técnica. É o custo desse contrato, não o preço de venda pro cliente." />
              </>
            }
            name="custoPorClique"
            type="number"
            step="0.0001"
            min="0"
            defaultValue={valoresIniciais.custoPorClique}
            hint="Multiplicado pela quantidade de peças × cliques por peça. O custo de substrato vem do preço de compra do produto."
          />
        </Card>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar impressora"}
        </Button>
      </form>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Excluir impressora</p>
            <p className="text-xs text-slate-500">
              Só é possível se nenhum produto do catálogo estiver usando esta impressora.
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
            pergunta={`Tem certeza que quer excluir a impressora "${valoresIniciais.nome}"? Essa ação não pode ser desfeita.`}
            onCancelar={() => setConfirmandoExclusao(false)}
            formAction={excluirAction}
            campos={{ impressoraId }}
            rotuloBotao="Excluir impressora"
            pendente={excluindo}
          />
        )}
      </Card>
    </div>
  );
}
