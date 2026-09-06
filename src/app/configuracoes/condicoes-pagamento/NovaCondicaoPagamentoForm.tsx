"use client";

import { useActionState, useState } from "react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { gerarChave } from "@/lib/chave-local";
import { criarCondicaoPagamento } from "./actions";
import { ROTULO_ANCORA_VENCIMENTO } from "./rotulos";
import { ParcelasCampos, type LinhaParcela } from "./ParcelasCampos";

export function NovaCondicaoPagamentoForm() {
  const [state, formAction, isPending] = useActionState(criarCondicaoPagamento, null);
  const [linhas, setLinhas] = useState<LinhaParcela[]>(() => [
    { chave: gerarChave(), percentual: "", diasAposAncora: "" },
  ]);

  const atualizar = (chave: string, campo: "percentual" | "diasAposAncora", valor: string) =>
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  const remover = (chave: string) => setLinhas((atual) => atual.filter((l) => l.chave !== chave));
  const adicionar = () =>
    setLinhas((atual) => [...atual, { chave: gerarChave(), percentual: "", diasAposAncora: "" }]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input
        type="hidden"
        name="parcelasJson"
        value={JSON.stringify(
          linhas
            .filter((l) => l.percentual && l.diasAposAncora !== "")
            .map(({ percentual, diasAposAncora }) => ({ percentual, diasAposAncora }))
        )}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Nome"
          name="nome"
          type="text"
          placeholder="ex: 30/60/90 com 2% de acréscimo"
          required
        />
        <Select label="Âncora do vencimento" name="ancora" defaultValue="APROVACAO">
          {Object.entries(ROTULO_ANCORA_VENCIMENTO).map(([valor, rotulo]) => (
            <option key={valor} value={valor}>
              {rotulo}
            </option>
          ))}
        </Select>
        <Input
          label="Acréscimo (%) (opcional)"
          name="acrescimoPercent"
          type="number"
          step="0.01"
          min="0"
          placeholder="ex: 2"
          hint="Somado ao total antes de dividir nas parcelas — deixe em branco se não houver acréscimo."
        />
      </div>
      <ParcelasCampos linhas={linhas} atualizar={atualizar} remover={remover} adicionar={adicionar} />
      {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
      <Button type="submit" loading={isPending} className="self-start">
        {isPending ? "Criando..." : "+ Nova condição"}
      </Button>
    </form>
  );
}
