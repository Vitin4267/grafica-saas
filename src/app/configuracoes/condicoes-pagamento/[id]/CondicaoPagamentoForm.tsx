"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { gerarChave } from "@/lib/chave-local";
import { ROTULO_ANCORA_VENCIMENTO } from "../rotulos";
import { editarCondicaoPagamento, alternarAtivaCondicaoPagamento } from "../actions";
import { ParcelasCampos, type LinhaParcela } from "../ParcelasCampos";

export function CondicaoPagamentoForm({
  condicaoId,
  nome,
  ancora,
  acrescimoPercent,
  parcelas,
  ativa,
}: {
  condicaoId: string;
  nome: string;
  ancora: string;
  acrescimoPercent: string;
  parcelas: { percentual: string; diasAposAncora: string }[];
  ativa: boolean;
}) {
  const [state, formAction, isPending] = useActionState(editarCondicaoPagamento, null);
  const [estadoAtiva, alternarAction, alternandoPending] = useActionState(
    alternarAtivaCondicaoPagamento,
    null
  );
  const [linhas, setLinhas] = useState<LinhaParcela[]>(() =>
    parcelas.length > 0
      ? parcelas.map((parcela) => ({ chave: gerarChave(), ...parcela }))
      : [{ chave: gerarChave(), percentual: "", diasAposAncora: "" }]
  );

  const atualizar = (chave: string, campo: "percentual" | "diasAposAncora", valor: string) =>
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  const remover = (chave: string) => setLinhas((atual) => atual.filter((l) => l.chave !== chave));
  const adicionar = () =>
    setLinhas((atual) => [...atual, { chave: gerarChave(), percentual: "", diasAposAncora: "" }]);

  return (
    <div className="flex flex-col gap-6">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="condicaoId" value={condicaoId} />
        <input
          type="hidden"
          name="parcelasJson"
          value={JSON.stringify(
            linhas
              .filter((l) => l.percentual && l.diasAposAncora !== "")
              .map(({ percentual, diasAposAncora }) => ({ percentual, diasAposAncora }))
          )}
        />
        <Card className="flex flex-col gap-4 p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input label="Nome" name="nome" type="text" defaultValue={nome} required />
            <Select label="Âncora do vencimento" name="ancora" defaultValue={ancora}>
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
              defaultValue={acrescimoPercent}
              hint="Somado ao total antes de dividir nas parcelas — deixe em branco se não houver acréscimo."
            />
          </div>
          <ParcelasCampos linhas={linhas} atualizar={atualizar} remover={remover} adicionar={adicionar} />
        </Card>
        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}
        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar condição"}
        </Button>
      </form>

      <Card className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm font-medium text-slate-900 dark:text-white">
            {ativa ? "Condição ativa" : "Condição inativa"}
          </p>
          <p className="text-xs text-slate-500">
            {ativa
              ? "Aparece pra seleção ao vincular a um orçamento."
              : "Some da seleção pra vínculo novo, mas orçamentos já vinculados a ela continuam no histórico. Nunca é excluída de verdade."}
          </p>
          {estadoAtiva && !estadoAtiva.ok && (
            <p className="mt-1 text-xs text-rose-600">{estadoAtiva.mensagem}</p>
          )}
        </div>
        <form action={alternarAction}>
          <input type="hidden" name="condicaoId" value={condicaoId} />
          <Button type="submit" variant="outline" loading={alternandoPending} className="shrink-0">
            {ativa ? "Desativar" : "Ativar"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
