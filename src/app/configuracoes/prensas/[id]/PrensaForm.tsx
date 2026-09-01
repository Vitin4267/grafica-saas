"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { salvarPrensa, excluirPrensa } from "../actions";

type ValoresPrensa = {
  nome: string;
  ativa: boolean;
  custoHoraMaq: string;
  torres: string;
  custoChapa: string;
  folhasAcerto: string;
  tempoAcertoH: string;
  custoMilheiroRod: string;
  rodagemMinima: string;
  perdaPercentPadrao: string;
};

export function PrensaForm({
  prensaId,
  valoresIniciais,
}: {
  prensaId: string;
  valoresIniciais: ValoresPrensa;
}) {
  const [state, formAction, isPending] = useActionState(salvarPrensa, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(excluirPrensa, null);
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false);

  useAoMudar(estadoExclusao, (estadoExclusao) => {
    if (estadoExclusao && !estadoExclusao.ok) setConfirmandoExclusao(false);
  });

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-6">
        <input type="hidden" name="prensaId" value={prensaId} />

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
                Prensa ativa (aparece pra seleção no catálogo)
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
              label={
                <>
                  Custo por hora de máquina (R$)
                  <CampoAjuda texto="Quanto custa manter esta prensa ligada e rodando por uma hora — energia, manutenção, depreciação, operador. Esse valor multiplica o tempo de acerto pra compor o custo de preparar a máquina antes de imprimir." />
                </>
              }
              name="custoHoraMaq"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.custoHoraMaq}
            />
            <Input
              label="Torres da prensa"
              name="torres"
              type="number"
              step="1"
              min="1"
              defaultValue={valoresIniciais.torres}
              hint="Quantas cores por passada de máquina"
            />
            <Input
              label="Custo por chapa (R$)"
              name="custoChapa"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.custoChapa}
            />
            <Input
              label={
                <>
                  Folhas de acerto
                  <CampoAjuda texto="Quantas folhas são gastas só ajustando a prensa até a impressão sair correta, antes de começar a produzir peças boas — não viram produto vendável, mas entram no custo." />
                </>
              }
              name="folhasAcerto"
              type="number"
              step="1"
              min="0"
              defaultValue={valoresIniciais.folhasAcerto}
            />
            <Input
              label={
                <>
                  Tempo de acerto (horas)
                  <CampoAjuda texto="Tempo que a prensa fica sendo ajustada e calibrada até a impressão sair correta — nesse período nenhuma peça boa é produzida, mas o tempo custa (energia, operador parado), então entra no preço final." />
                </>
              }
              name="tempoAcertoH"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.tempoAcertoH}
            />
            <Input
              label={
                <>
                  Custo por milheiro de rodagem (R$)
                  <CampoAjuda texto="Custo variável cobrado a cada mil folhas impressas, já descontado o acerto — multiplicado pela quantidade do pedido pra compor o preço." />
                </>
              }
              name="custoMilheiroRod"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.custoMilheiroRod}
            />
            <Input
              label={
                <>
                  Rodagem mínima (R$)
                  <CampoAjuda texto="Valor mínimo cobrado pela produção, mesmo que o cálculo normal (custo por milheiro × quantidade) resulte num valor menor — evita rodar um trabalho pequeno demais pra compensar ligar a máquina." />
                </>
              }
              name="rodagemMinima"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.rodagemMinima}
            />
            <Input
              label={
                <>
                  Perda padrão (%)
                  <CampoAjuda texto="Percentual de material que normalmente se perde no processo (folhas com defeito, ajuste de cor etc.) — aplicado automaticamente no cálculo pra já embutir essa perda esperada no preço." />
                </>
              }
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
          {isPending ? "Salvando..." : "Salvar prensa"}
        </Button>
      </form>

      <Card className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-slate-900 dark:text-white">Excluir prensa</p>
            <p className="text-xs text-slate-500">
              Só é possível se nenhum produto do catálogo estiver usando esta prensa.
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
            pergunta={`Tem certeza que quer excluir a prensa "${valoresIniciais.nome}"? Essa ação não pode ser desfeita.`}
            onCancelar={() => setConfirmandoExclusao(false)}
            formAction={excluirAction}
            campos={{ prensaId }}
            rotuloBotao="Excluir prensa"
            pendente={excluindo}
          />
        )}
      </Card>
    </div>
  );
}
