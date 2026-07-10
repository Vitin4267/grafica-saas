"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ROTULO_UNIDADE } from "@/lib/unidade";
import { salvarFichaTecnica } from "./actions";

type MateriaPrima = { id: string; nome: string; unidade: string | null };
type Linha = { chave: string; materiaPrimaId: string; quantidadePorUnidade: string };

// TODO(review): gerarChave() está copiada igualzinha em ConfiguracaoProdutoForm.tsx
// (mesma pasta) e em orcamento/CalculadoraForm.tsx — só serve pra gerar `key` de
// linha em array editável no cliente, dava pra virar um helper em src/lib.
function gerarChave() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function FichaTecnicaForm({
  itemGraficaId,
  materiasPrimas,
  fichaAtual,
}: {
  itemGraficaId: string;
  materiasPrimas: MateriaPrima[];
  fichaAtual: { materiaPrimaId: string; quantidadePorUnidade: string }[];
}) {
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    fichaAtual.map((f) => ({ chave: gerarChave(), ...f }))
  );
  const [state, formAction, isPending] = useActionState(salvarFichaTecnica, null);

  const idsUsados = new Set(linhas.map((l) => l.materiaPrimaId).filter(Boolean));
  const disponiveis = materiasPrimas.filter((m) => !idsUsados.has(m.id));

  const atualizar = (
    chave: string,
    campo: "materiaPrimaId" | "quantidadePorUnidade",
    valor: string
  ) => {
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  };
  const remover = (chave: string) =>
    setLinhas((atual) => atual.filter((l) => l.chave !== chave));
  const adicionar = () => {
    const primeira = disponiveis[0];
    if (!primeira) return;
    setLinhas((atual) => [
      ...atual,
      { chave: gerarChave(), materiaPrimaId: primeira.id, quantidadePorUnidade: "" },
    ]);
  };

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Ficha técnica
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Quanto de cada matéria-prima esse produto consome por unidade vendida.
          Usado pra descontar o estoque automaticamente quando o pedido entra em
          produção.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
        <input
          type="hidden"
          name="fichaTecnicaJson"
          value={JSON.stringify(
            linhas
              .filter((l) => l.materiaPrimaId)
              .map(({ materiaPrimaId, quantidadePorUnidade }) => ({
                materiaPrimaId,
                quantidadePorUnidade,
              }))
          )}
        />

        {materiasPrimas.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhuma matéria-prima ativa no Catálogo ainda. Ative alguma em{" "}
            <span className="font-medium">Catálogo → Matérias-primas</span> pra
            poder montar a ficha técnica.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {linhas.length === 0 && (
              <p className="text-sm text-slate-500">
                Nenhuma matéria-prima vinculada ainda.
              </p>
            )}
            {linhas.map((linha) => {
              const materiaAtual = materiasPrimas.find((m) => m.id === linha.materiaPrimaId);
              const opcoes = materiaAtual ? [materiaAtual, ...disponiveis] : disponiveis;
              return (
                <div key={linha.chave} className="flex items-end gap-3">
                  <div className="flex-1">
                    <Select
                      label="Matéria-prima"
                      value={linha.materiaPrimaId}
                      onChange={(e) => atualizar(linha.chave, "materiaPrimaId", e.target.value)}
                    >
                      {opcoes.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nome}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="w-44">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                        Qtd. por unidade
                      </span>
                      <input
                        type="number"
                        step="0.000001"
                        min="0"
                        value={linha.quantidadePorUnidade}
                        onChange={(e) =>
                          atualizar(linha.chave, "quantidadePorUnidade", e.target.value)
                        }
                        placeholder={materiaAtual?.unidade ? ROTULO_UNIDADE[materiaAtual.unidade] : "0"}
                        className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-slate-900 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => remover(linha.chave)}
                    className="mb-0.5 rounded-lg px-3 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
                  >
                    Remover
                  </button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="outline"
              onClick={adicionar}
              disabled={disponiveis.length === 0}
              className="self-start"
            >
              + Adicionar matéria-prima
            </Button>
          </div>
        )}

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar ficha técnica"}
        </Button>
      </form>
    </Card>
  );
}
