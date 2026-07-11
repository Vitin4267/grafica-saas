"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ROTULO_UNIDADE } from "@/lib/unidade";
import { gerarChave } from "@/lib/chave-local";
import { salvarFichaTecnica } from "./actions";

type Variante = { id: string; rotulo: string };
type MateriaPrima = { id: string; nome: string; unidade: string | null; variantes: Variante[] };
type Linha = {
  chave: string;
  materiaPrimaId: string;
  varianteId: string;
  quantidadePorUnidade: string;
};

export function FichaTecnicaForm({
  itemGraficaId,
  materiasPrimas,
  fichaAtual,
}: {
  itemGraficaId: string;
  materiasPrimas: MateriaPrima[];
  fichaAtual: { materiaPrimaId: string; varianteId: string; quantidadePorUnidade: string }[];
}) {
  const [linhas, setLinhas] = useState<Linha[]>(() =>
    fichaAtual.map((f) => ({ chave: gerarChave(), ...f }))
  );
  const [state, formAction, isPending] = useActionState(salvarFichaTecnica, null);

  // Matéria-prima SEM variantes só pode aparecer numa linha (uma "unidade" só
  // de consumo). Com variantes, pode reaparecer contanto que use uma
  // variante diferente da já escolhida em outra linha (ex: consome chapa de
  // 2mm E de 5mm) — por isso só filtra pelas variantes já usadas, não pelo
  // materiaPrimaId inteiro.
  const variantesUsadas = new Set(linhas.map((l) => l.varianteId).filter(Boolean));
  const idsSemVarianteUsados = new Set(
    linhas.filter((l) => !l.varianteId).map((l) => l.materiaPrimaId)
  );
  const disponiveis = materiasPrimas.filter((m) => {
    if (m.variantes.length > 0) {
      return m.variantes.some((v) => !variantesUsadas.has(v.id));
    }
    return !idsSemVarianteUsados.has(m.id);
  });

  const atualizar = (
    chave: string,
    campo: "materiaPrimaId" | "varianteId" | "quantidadePorUnidade",
    valor: string
  ) => {
    setLinhas((atual) =>
      atual.map((l) => {
        if (l.chave !== chave) return l;
        // Trocar de matéria-prima limpa a variante escolhida antes (senão
        // fica um varianteId órfão apontando pra outra matéria-prima).
        if (campo === "materiaPrimaId") return { ...l, materiaPrimaId: valor, varianteId: "" };
        return { ...l, [campo]: valor };
      })
    );
  };
  const remover = (chave: string) =>
    setLinhas((atual) => atual.filter((l) => l.chave !== chave));
  const adicionar = () => {
    const primeira = disponiveis[0];
    if (!primeira) return;
    const primeiraVarianteLivre = primeira.variantes.find((v) => !variantesUsadas.has(v.id));
    setLinhas((atual) => [
      ...atual,
      {
        chave: gerarChave(),
        materiaPrimaId: primeira.id,
        varianteId: primeiraVarianteLivre?.id ?? "",
        quantidadePorUnidade: "",
      },
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
              .map(({ materiaPrimaId, varianteId, quantidadePorUnidade }) => ({
                materiaPrimaId,
                varianteId: varianteId || undefined,
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
              const opcoes = materiaAtual
                ? [materiaAtual, ...disponiveis.filter((m) => m.id !== materiaAtual.id)]
                : disponiveis;
              const variantesDisponiveis =
                materiaAtual?.variantes.filter(
                  (v) => v.id === linha.varianteId || !variantesUsadas.has(v.id)
                ) ?? [];
              return (
                <div key={linha.chave} className="flex flex-wrap items-end gap-3">
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
                  {materiaAtual && materiaAtual.variantes.length > 0 && (
                    <div className="w-32">
                      <Select
                        label="Variante"
                        value={linha.varianteId}
                        onChange={(e) => atualizar(linha.chave, "varianteId", e.target.value)}
                      >
                        <option value="">Selecione</option>
                        {variantesDisponiveis.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.rotulo}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}
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
