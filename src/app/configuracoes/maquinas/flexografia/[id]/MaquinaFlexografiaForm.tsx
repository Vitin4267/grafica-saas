"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { salvarMaquinaFlexografia, excluirMaquinaFlexografia } from "../actions";

type ValoresMaquinaFlexografia = {
  nome: string;
  ativa: boolean;
  larguraMaquinaM: string;
  passoCilindroM: string;
  numeroEstacoesCores: string;
  custoHoraMaq: string;
  tempoAcertoH: string;
  metrosAcerto: string;
  custoMetroLinearRod: string;
  rodagemMinima: string;
  perdaPercentPadrao: string;
};

export function MaquinaFlexografiaForm({
  maquinaId,
  valoresIniciais,
}: {
  maquinaId: string;
  valoresIniciais: ValoresMaquinaFlexografia;
}) {
  const [state, formAction, isPending] = useActionState(salvarMaquinaFlexografia, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(
    excluirMaquinaFlexografia,
    null
  );
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useAoMudar(estadoExclusao, (estadoExclusao) => {
    if (estadoExclusao && !estadoExclusao.ok) setConfirmandoExclusao(false);
  });

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-6">
        <input type="hidden" name="maquinaId" value={maquinaId} />

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
                Máquina ativa (aparece pra seleção no catálogo)
              </span>
            </label>
          </div>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Custo de máquina
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Largura útil da máquina (m)"
              name="larguraMaquinaM"
              type="number"
              step="0.001"
              min="0"
              defaultValue={valoresIniciais.larguraMaquinaM}
            />
            <Input
              label="Passo do cilindro (m)"
              name="passoCilindroM"
              type="number"
              step="0.001"
              min="0"
              defaultValue={valoresIniciais.passoCilindroM}
            />
            <Input
              label="Nº de estações de cor"
              name="numeroEstacoesCores"
              type="number"
              step="1"
              min="1"
              defaultValue={valoresIniciais.numeroEstacoesCores}
            />
            <Input
              label="Custo hora-máquina (R$)"
              name="custoHoraMaq"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.custoHoraMaq}
            />
            <Input
              label="Tempo de acerto (h)"
              name="tempoAcertoH"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.tempoAcertoH}
            />
            <Input
              label="Metros de bobina perdidos no acerto"
              name="metrosAcerto"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.metrosAcerto}
            />
            <Input
              label="Custo por metro linear rodado (R$)"
              name="custoMetroLinearRod"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.custoMetroLinearRod}
            />
            <Input
              label="Rodagem mínima (R$)"
              name="rodagemMinima"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.rodagemMinima}
            />
            <Input
              label="Perda padrão (%)"
              name="perdaPercentPadrao"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={valoresIniciais.perdaPercentPadrao}
            />
          </div>
        </Card>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar máquina"}
        </Button>
      </form>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Excluir máquina</p>
            <p className="text-xs text-slate-500">
              Só é possível se nenhum produto do catálogo estiver usando esta máquina.
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
            pergunta={`Tem certeza que quer excluir a máquina "${valoresIniciais.nome}"? Essa ação não pode ser desfeita.`}
            onCancelar={() => setConfirmandoExclusao(false)}
            formAction={excluirAction}
            campos={{ maquinaId }}
            rotuloBotao="Excluir máquina"
            pendente={excluindo}
          />
        )}
      </Card>
    </div>
  );
}
