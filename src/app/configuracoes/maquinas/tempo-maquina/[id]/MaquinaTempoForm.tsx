"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { salvarMaquinaTempo, excluirMaquinaTempo } from "../actions";

type ValoresMaquinaTempo = {
  nome: string;
  ativa: boolean;
  custoHoraMaq: string;
  custoSetupPorJob: string;
  custoMinimo: string;
  custoPorMetroCorte: string;
};

export function MaquinaTempoForm({
  maquinaId,
  valoresIniciais,
}: {
  maquinaId: string;
  valoresIniciais: ValoresMaquinaTempo;
}) {
  const [state, formAction, isPending] = useActionState(salvarMaquinaTempo, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(excluirMaquinaTempo, null);
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
          <Input
            label={
              <>
                Custo por hora de máquina (R$)
                <CampoAjuda texto="Custo de ter esta máquina ligada por 1 hora — energia, manutenção, depreciação. Multiplicado pelo tempo estimado (em minutos ÷ 60) informado no orçamento." />
              </>
            }
            name="custoHoraMaq"
            type="number"
            step="0.01"
            min="0"
            defaultValue={valoresIniciais.custoHoraMaq}
          />
          <Input
            label={
              <>
                Custo de setup por job (R$)
                <CampoAjuda texto="Custo fixo de preparar a máquina pra este pedido (posicionar material, ajustar foco/ferramenta) — cobrado 1 VEZ por item de orçamento, não escala com a quantidade de peças." />
              </>
            }
            name="custoSetupPorJob"
            type="number"
            step="0.01"
            min="0"
            defaultValue={valoresIniciais.custoSetupPorJob}
            hint="Cobrado 1× por item, independente da quantidade."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Custo mínimo do job (R$, opcional)"
              name="custoMinimo"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.custoMinimo}
              placeholder="opcional"
              hint="Piso do custo — o pedido nunca custa menos que isso."
            />
            <Input
              label={
                <>
                  Custo por metro de corte (R$, opcional)
                  <CampoAjuda texto="Deixe em branco se esta máquina só cobra por tempo. Preencha se ela também (ou só) cobra por metro linear cortado — o vendedor informa os metros de corte no orçamento." />
                </>
              }
              name="custoPorMetroCorte"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.custoPorMetroCorte}
              placeholder="opcional"
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
