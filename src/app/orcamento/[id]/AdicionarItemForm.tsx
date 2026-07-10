"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { adicionarItemOrcamento } from "./actions";
import {
  SeletorItemOrcamento,
  camposIniciais,
  type ItemVenda,
  type CamposItemOrcamento,
} from "../SeletorItemOrcamento";

export function AdicionarItemForm({
  orcamentoId,
  itens,
}: {
  orcamentoId: string;
  itens: ItemVenda[];
}) {
  const [campos, setCampos] = useState<CamposItemOrcamento>(() => camposIniciais(itens));
  const [state, formAction, isPending] = useActionState(adicionarItemOrcamento, null);
  const [estadoAnterior, setEstadoAnterior] = useState(state);

  // Mesmo padrão de reset pós-sucesso do UsuarioForm — limpa os campos depois
  // que o item é adicionado, pra ficar pronto pro próximo.
  if (state !== estadoAnterior) {
    setEstadoAnterior(state);
    if (state?.ok) setCampos(camposIniciais(itens));
  }

  if (itens.length === 0) return null;

  return (
    <Card className="p-6">
      <h3 className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">
        + Adicionar item
      </h3>
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="orcamentoId" value={orcamentoId} />
        <input type="hidden" name="itemGraficaId" value={campos.itemGraficaId} />
        <input type="hidden" name="quantidade" value={campos.quantidade} />
        <input type="hidden" name="larguraCm" value={campos.larguraCm} />
        <input type="hidden" name="alturaCm" value={campos.alturaCm} />
        <input type="hidden" name="corFrente" value={campos.corFrente} />
        <input type="hidden" name="corVerso" value={campos.corVerso} />
        <input type="hidden" name="cores" value={campos.cores} />
        <input type="hidden" name="acabamento" value={campos.acabamento} />

        <SeletorItemOrcamento itens={itens} valores={campos} onChange={setCampos} />

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Adicionando..." : "Adicionar item"}
        </Button>
      </form>
    </Card>
  );
}
