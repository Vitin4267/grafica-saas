"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { editarOrcamento, removerItemOrcamento } from "./actions";

export function EditarOrcamentoForm({
  orcamentoId,
  orcamentoItemId,
  itemNome,
  modeloCalculo,
  valoresIniciais,
  podeRemover,
}: {
  orcamentoId: string;
  orcamentoItemId: string;
  itemNome: string;
  modeloCalculo: "SIMPLES" | "M2" | "OFFSET";
  valoresIniciais: {
    quantidade: number;
    larguraCm: string;
    alturaCm: string;
    cores: string;
    acabamento: string;
    corFrente: string;
    corVerso: string;
  };
  podeRemover: boolean;
}) {
  const [state, formAction, isPending] = useActionState(editarOrcamento, null);
  const [estadoRemocao, acaoRemover, removendoPending] = useActionState(
    removerItemOrcamento,
    null
  );
  const usaMotorAvancado = modeloCalculo === "M2" || modeloCalculo === "OFFSET";
  const [larguraCm, setLarguraCm] = useState(valoresIniciais.larguraCm);
  const [alturaCm, setAlturaCm] = useState(valoresIniciais.alturaCm);

  return (
    <Card className="mb-4 p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Produto:{" "}
          <span className="font-medium text-slate-800 dark:text-slate-200">{itemNome}</span>{" "}
          <span className="text-xs">(não pode ser trocado — remova e adicione outro)</span>
        </p>
        {podeRemover && (
          <form action={acaoRemover}>
            <input type="hidden" name="orcamentoItemId" value={orcamentoItemId} />
            <button
              type="submit"
              disabled={removendoPending}
              className="shrink-0 text-xs font-medium text-rose-600 hover:underline disabled:opacity-50"
            >
              Remover item
            </button>
          </form>
        )}
      </div>

      {estadoRemocao && !estadoRemocao.ok && (
        <div className="mb-4">
          <Alert variant="error">{estadoRemocao.mensagem}</Alert>
        </div>
      )}

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="orcamentoId" value={orcamentoId} />
        <input type="hidden" name="orcamentoItemId" value={orcamentoItemId} />

        <Input
          label="Quantidade"
          name="quantidade"
          type="number"
          min={1}
          required
          defaultValue={valoresIniciais.quantidade}
        />

        {usaMotorAvancado && (
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Largura (cm)"
              name="larguraCm"
              type="number"
              required
              value={larguraCm}
              onChange={(e) => setLarguraCm(e.target.value)}
            />
            <Input
              label="Altura (cm)"
              name="alturaCm"
              type="number"
              required
              value={alturaCm}
              onChange={(e) => setAlturaCm(e.target.value)}
            />
          </div>
        )}

        {modeloCalculo === "OFFSET" && (
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Cores de frente"
              name="corFrente"
              type="number"
              min={1}
              required
              defaultValue={valoresIniciais.corFrente}
            />
            <Input
              label="Cores de verso"
              name="corVerso"
              type="number"
              min={0}
              defaultValue={valoresIniciais.corVerso}
            />
          </div>
        )}

        <Input
          label="Cores"
          name="cores"
          defaultValue={valoresIniciais.cores}
          placeholder="ex: 4x0, 4x4"
        />
        <Input
          label="Acabamento"
          name="acabamento"
          defaultValue={valoresIniciais.acabamento}
          placeholder="ex: laminação fosca, corte reto"
        />

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar alterações"}
        </Button>
      </form>
    </Card>
  );
}
