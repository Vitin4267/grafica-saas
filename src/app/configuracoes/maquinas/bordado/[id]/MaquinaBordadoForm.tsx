"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { CampoAjuda } from "@/components/ui/CampoAjuda";
import { salvarMaquinaBordado, excluirMaquinaBordado } from "../actions";

type ValoresMaquinaBordado = {
  nome: string;
  ativa: boolean;
  custoPorMilPontos: string;
  custoMatrizDigitalizacao: string;
  cabecas: string;
  custoHoraMaq: string;
  custoMinimo: string;
};

export function MaquinaBordadoForm({
  maquinaId,
  valoresIniciais,
}: {
  maquinaId: string;
  valoresIniciais: ValoresMaquinaBordado;
}) {
  const [state, formAction, isPending] = useActionState(salvarMaquinaBordado, null);
  const [estadoExclusao, excluirAction, excluindo] = useActionState(excluirMaquinaBordado, null);
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
          <Input
            label={
              <>
                Número de cabeças
                <CampoAjuda texto="Quantas peças esta máquina borda ao mesmo tempo, num único ciclo — puramente informativo, não entra no cálculo de custo desta versão." />
              </>
            }
            name="cabecas"
            type="number"
            step="1"
            min="1"
            defaultValue={valoresIniciais.cabecas}
          />
        </Card>

        <Card className="flex flex-col gap-4 p-6">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Custo de máquina
          </h2>
          <Input
            label={
              <>
                Custo por mil pontos (R$)
                <CampoAjuda texto="Quanto custa bordar 1.000 pontos de arte — linha de bordar, linha de bobina, entretela e desgaste da máquina já embutidos. Multiplicado por (nº de pontos da arte ÷ 1000) e pela quantidade de peças do pedido." />
              </>
            }
            name="custoPorMilPontos"
            type="number"
            step="0.01"
            min="0"
            defaultValue={valoresIniciais.custoPorMilPontos}
            hint="Referência de mercado: ~R$0,75 por 1.000 pontos (varia com o tipo de linha e entretela)."
          />
          <Input
            label={
              <>
                Taxa de digitalização de matriz (R$)
                <CampoAjuda texto="Custo de transformar a arte (logo, desenho) num programa de bordado que a máquina entende — cobrado 1 VEZ por arte, não escala com a quantidade de peças (mesmo princípio do clichê de etiqueta/flexografia)." />
              </>
            }
            name="custoMatrizDigitalizacao"
            type="number"
            step="0.01"
            min="0"
            defaultValue={valoresIniciais.custoMatrizDigitalizacao}
            hint="Cobrado 1× por pedido, independente de quantas peças forem bordadas."
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label={
                <>
                  Custo por hora de máquina (R$, opcional)
                  <CampoAjuda texto="Deixe em branco se o custo de máquina já está embutido no custo por mil pontos acima. Preencha só se quiser separar o custo de hora-máquina (energia, manutenção) do custo por ponto." />
                </>
              }
              name="custoHoraMaq"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.custoHoraMaq}
              placeholder="opcional"
            />
            <Input
              label="Custo mínimo do job (R$, opcional)"
              name="custoMinimo"
              type="number"
              step="0.01"
              min="0"
              defaultValue={valoresIniciais.custoMinimo}
              placeholder="opcional"
              hint="Piso do custo — o pedido nunca custa menos que isso, mesmo com poucos pontos/peças."
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
