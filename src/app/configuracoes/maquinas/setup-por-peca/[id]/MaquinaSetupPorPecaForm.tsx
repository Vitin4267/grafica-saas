"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { ORDEM_PROCESSO_SETUP_POR_PECA, ROTULO_PROCESSO_SETUP_POR_PECA } from "@/lib/tipos-equipamento";
import { salvarMaquinaSetupPorPeca, excluirMaquinaSetupPorPeca } from "../actions";
import type { ProcessoSetupPorPeca } from "@/generated/prisma/enums";

type ValoresMaquinaSetupPorPeca = {
  nome: string;
  ativa: boolean;
  tipoProcesso: ProcessoSetupPorPeca;
  custoPorSetup: string;
  custoPorPeca: string;
  custoMinimo: string;
};

export function MaquinaSetupPorPecaForm({
  maquinaId,
  valoresIniciais,
}: {
  maquinaId: string;
  valoresIniciais: ValoresMaquinaSetupPorPeca;
}) {
  const [state, formAction, isPending] = useActionState(salvarMaquinaSetupPorPeca, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(
    excluirMaquinaSetupPorPeca,
    null
  );
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);
  const [tipoProcesso, setTipoProcesso] = useState<ProcessoSetupPorPeca>(
    valoresIniciais.tipoProcesso
  );

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
          <Select
            label="Processo"
            name="tipoProcesso"
            value={tipoProcesso}
            onChange={(e) => setTipoProcesso(e.target.value as ProcessoSetupPorPeca)}
            hint="Só produtos deste processo poderão selecionar esta máquina."
          >
            {ORDEM_PROCESSO_SETUP_POR_PECA.map((valor) => (
              <option key={valor} value={valor}>
                {ROTULO_PROCESSO_SETUP_POR_PECA[valor]}
              </option>
            ))}
          </Select>
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Custo de máquina
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input
              label="Custo por setup (R$)"
              name="custoPorSetup"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={valoresIniciais.custoPorSetup}
              hint="Por tela/matriz/arte."
            />
            <Input
              label="Custo por peça (R$)"
              name="custoPorPeca"
              type="number"
              step="0.0001"
              min="0"
              defaultValue={valoresIniciais.custoPorPeca}
            />
            <Input
              label="Custo mínimo do job (R$)"
              name="custoMinimo"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.custoMinimo}
              hint="Piso — se setup + variável ficar abaixo disso, cobra este valor."
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
