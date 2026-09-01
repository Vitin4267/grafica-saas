"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
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
              label={
                <>
                  Largura útil da máquina (m)
                  <CampoAjuda texto="Largura máxima de bobina que esta máquina consegue imprimir — usada pra saber se ela serve pra um pedido e pra calcular quanto material é gasto." />
                </>
              }
              name="larguraMaquinaM"
              type="number"
              step="0.001"
              min="0"
              defaultValue={valoresIniciais.larguraMaquinaM}
            />
            <Input
              label={
                <>
                  Passo do cilindro (m)
                  <CampoAjuda texto="Comprimento de uma volta completa do cilindro de impressão — define o tamanho máximo que a arte pode repetir ao longo da bobina nesta máquina." />
                </>
              }
              name="passoCilindroM"
              type="number"
              step="0.001"
              min="0"
              defaultValue={valoresIniciais.passoCilindroM}
            />
            <Input
              label={
                <>
                  Nº de estações de cor
                  <CampoAjuda texto="Quantas cores esta máquina imprime numa única passada — cada estação aplica uma cor. Um trabalho com mais cores do que estações precisa de mais de uma passada pela máquina." />
                </>
              }
              name="numeroEstacoesCores"
              type="number"
              step="1"
              min="1"
              defaultValue={valoresIniciais.numeroEstacoesCores}
            />
            <Input
              label={
                <>
                  Custo hora-máquina (R$)
                  <CampoAjuda texto="Quanto custa manter esta máquina ligada e rodando por uma hora — energia, manutenção, depreciação, operador. Esse valor multiplica o tempo de acerto pra compor o custo de preparar a máquina antes de produzir." />
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
                  Tempo de acerto (h)
                  <CampoAjuda texto="Tempo que a máquina fica sendo ajustada e calibrada até a impressão sair correta — nesse período nenhuma peça boa é produzida, mas o tempo custa (energia, operador parado), então entra no preço final." />
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
                  Metros de bobina perdidos no acerto
                  <CampoAjuda texto="Quantos metros de bobina são gastos só ajustando a máquina até a impressão sair correta, antes de começar a produzir peças boas — não viram produto vendável, mas entram no custo." />
                </>
              }
              name="metrosAcerto"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.metrosAcerto}
            />
            <Input
              label={
                <>
                  Custo por metro linear rodado (R$)
                  <CampoAjuda texto="Custo variável cobrado por metro de bobina efetivamente impresso, já descontado o acerto — multiplicado pela metragem do pedido pra compor o preço." />
                </>
              }
              name="custoMetroLinearRod"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.custoMetroLinearRod}
            />
            <Input
              label={
                <>
                  Rodagem mínima (R$)
                  <CampoAjuda texto="Valor mínimo cobrado pela produção, mesmo que o cálculo normal (custo por metro × quantidade) resulte num valor menor — evita rodar um trabalho pequeno demais pra compensar ligar a máquina." />
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
                  <CampoAjuda texto="Percentual de material que normalmente se perde no processo (metros com defeito, ajuste de cor etc.) — aplicado automaticamente no cálculo pra já embutir essa perda esperada no preço." />
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
