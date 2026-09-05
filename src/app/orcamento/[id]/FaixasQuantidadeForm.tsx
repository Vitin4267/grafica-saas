"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatoMoeda } from "@/lib/moeda";
import { adicionarFaixaQuantidadeOrcamento, removerFaixaQuantidadeOrcamento } from "./actions";

export type FaixaQuantidade = {
  id: string;
  quantidade: number;
  precoUnitario: string;
  precoTotal: string;
};

// Achado B5 da auditoria de abrangência (Parte 1) — tabela de tiragens
// alternativas do mesmo item ("1.000/3.000/5.000 unidades"), o formato
// clássico do orçamento gráfico brasileiro. Cada linha é recalculada pelo
// mesmo motor de precificação do item principal (calcularItemOrcamento, com
// a mesma configuração — só a quantidade muda), então a diluição de
// setup/clichê/chapa acontece sozinha. Puramente uma tabela COMPARATIVA:
// nunca entra em Orcamento.total nem substitui a quantidade do item — ver
// LIMITAÇÃO CONHECIDA de promoção manual no comentário do model
// OrcamentoItemFaixaQuantidade (schema 09-orcamento.prisma).
export function FaixasQuantidadeForm({
  orcamentoItemId,
  faixas,
  maxFaixas,
}: {
  orcamentoItemId: string;
  faixas: FaixaQuantidade[];
  // MAX_FAIXAS_QUANTIDADE (src/lib/orcamento-faixas-quantidade.ts) resolvido
  // pelo pai (Server Component) — aquele módulo é "server-only", não pode
  // ser importado direto aqui.
  maxFaixas: number;
}) {
  const [state, formAction, isPending] = useActionState(adicionarFaixaQuantidadeOrcamento, null);
  const [estadoRemocao, acaoRemover] = useActionState(removerFaixaQuantidadeOrcamento, null);
  const [mostrarForm, setMostrarForm] = useState(false);

  return (
    <Card className="mb-4 -mt-2 p-5">
      <p className="mb-2 text-sm font-medium text-slate-500">
        Faixas de quantidade{" "}
        <span className="font-normal text-slate-400">
          (tabela comparativa — não altera este item, só mostra outras tiragens ao cliente)
        </span>
      </p>

      {faixas.length > 0 && (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="pb-1 pr-3 font-medium">Quantidade</th>
                <th className="pb-1 pr-3 font-medium">Unitário</th>
                <th className="pb-1 pr-3 font-medium">Total</th>
                <th className="pb-1" />
              </tr>
            </thead>
            <tbody>
              {faixas.map((faixa) => (
                <tr key={faixa.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-3">{faixa.quantidade.toLocaleString("pt-BR")}</td>
                  <td className="py-1.5 pr-3">{formatoMoeda.format(Number(faixa.precoUnitario))}</td>
                  <td className="py-1.5 pr-3 font-medium">{formatoMoeda.format(Number(faixa.precoTotal))}</td>
                  <td className="py-1.5 text-right">
                    <form action={acaoRemover}>
                      <input type="hidden" name="faixaId" value={faixa.id} />
                      <Button
                        type="submit"
                        variant="ghost"
                        className="h-auto px-0 py-0 text-xs font-medium text-rose-600 hover:underline"
                      >
                        Remover
                      </Button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {estadoRemocao && !estadoRemocao.ok && (
        <div className="mb-3">
          <Alert variant="error">{estadoRemocao.mensagem}</Alert>
        </div>
      )}

      {faixas.length >= maxFaixas ? (
        <p className="text-xs text-slate-400">
          Este item já tem o máximo de {maxFaixas} faixas de quantidade.
        </p>
      ) : !mostrarForm ? (
        <button
          type="button"
          onClick={() => setMostrarForm(true)}
          className="text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
        >
          + Adicionar faixa de quantidade
        </button>
      ) : (
        <form action={formAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="orcamentoItemId" value={orcamentoItemId} />
          <div className="flex-1">
            <Input label="Quantidade" name="quantidade" type="number" step="1" min={1} required />
          </div>
          <div className="flex items-center gap-2">
            <Button type="submit" loading={isPending} variant="outline">
              {isPending ? "Calculando..." : "Adicionar"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMostrarForm(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}

      {state && !state.ok && (
        <div className="mt-3">
          <Alert variant="error">{state.mensagem}</Alert>
        </div>
      )}
    </Card>
  );
}
