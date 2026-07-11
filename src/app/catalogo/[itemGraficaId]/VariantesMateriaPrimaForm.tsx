"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { gerarChave } from "@/lib/chave-local";
import { salvarVariantesMateriaPrima } from "./actions";

type LinhaVariante = {
  chave: string;
  id: string; // vazio = linha nova, ainda não existe no banco
  rotulo: string;
  precoCompra: string;
  estoqueAtual: string;
  estoqueMinimo: string;
};

function CampoLinha({
  value,
  onChange,
  placeholder,
  step,
  min,
}: {
  value: string;
  onChange: (valor: string) => void;
  placeholder: string;
  step: string;
  min: string;
}) {
  return (
    <input
      type="number"
      step={step}
      min={min}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
    />
  );
}

export function VariantesMateriaPrimaForm({
  itemGraficaId,
  linhasIniciais,
}: {
  itemGraficaId: string;
  linhasIniciais: {
    id: string;
    rotulo: string;
    precoCompra: string;
    estoqueAtual: string;
    estoqueMinimo: string;
  }[];
}) {
  const [linhas, setLinhas] = useState<LinhaVariante[]>(() =>
    linhasIniciais.length > 0
      ? linhasIniciais.map((l) => ({ chave: gerarChave(), ...l }))
      : [{ chave: gerarChave(), id: "", rotulo: "", precoCompra: "", estoqueAtual: "", estoqueMinimo: "" }]
  );
  const [state, formAction, isPending] = useActionState(salvarVariantesMateriaPrima, null);

  const atualizar = (
    chave: string,
    campo: "rotulo" | "precoCompra" | "estoqueAtual" | "estoqueMinimo",
    valor: string
  ) => {
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  };
  const remover = (chave: string) => setLinhas((atual) => atual.filter((l) => l.chave !== chave));
  const adicionar = () =>
    setLinhas((atual) => [
      ...atual,
      { chave: gerarChave(), id: "", rotulo: "", precoCompra: "", estoqueAtual: "", estoqueMinimo: "" },
    ]);

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Variantes, preço e estoque
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Este material vira um único item no catálogo — cada variante (ex: espessura) é uma
          linha aqui, com seu próprio preço de compra e estoque, não um cadastro novo. Remover
          uma linha aqui só some ela da lista — se já foi usada em alguma ficha técnica ou
          movimentação de estoque, o histórico continua intacto.
        </p>
      </div>

      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
        <input
          type="hidden"
          name="variantesJson"
          value={JSON.stringify(
            linhas
              .filter((l) => l.rotulo && l.precoCompra)
              .map(({ id, rotulo, precoCompra, estoqueAtual, estoqueMinimo }) => ({
                id: id || undefined,
                rotulo,
                precoCompra,
                estoqueAtual: estoqueAtual || undefined,
                estoqueMinimo: estoqueMinimo || undefined,
              }))
          )}
        />

        <div className="flex flex-col gap-3">
          {linhas.map((linha) => (
            <div key={linha.chave} className="flex flex-wrap items-end gap-3">
              <label className="flex w-28 flex-col gap-1">
                <span className="text-xs text-slate-500">Rótulo</span>
                <input
                  type="text"
                  value={linha.rotulo}
                  onChange={(e) => atualizar(linha.chave, "rotulo", e.target.value)}
                  placeholder="ex: 3mm"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </label>
              <label className="flex w-32 flex-col gap-1">
                <span className="text-xs text-slate-500">Preço de compra (R$)</span>
                <CampoLinha
                  value={linha.precoCompra}
                  onChange={(v) => atualizar(linha.chave, "precoCompra", v)}
                  placeholder="ex: 89.90"
                  step="0.01"
                  min="0"
                />
              </label>
              <label className="flex w-28 flex-col gap-1">
                <span className="text-xs text-slate-500">Estoque atual</span>
                <CampoLinha
                  value={linha.estoqueAtual}
                  onChange={(v) => atualizar(linha.chave, "estoqueAtual", v)}
                  placeholder="opcional"
                  step="0.01"
                  min="0"
                />
              </label>
              <label className="flex w-28 flex-col gap-1">
                <span className="text-xs text-slate-500">Estoque mínimo</span>
                <CampoLinha
                  value={linha.estoqueMinimo}
                  onChange={(v) => atualizar(linha.chave, "estoqueMinimo", v)}
                  placeholder="opcional"
                  step="0.01"
                  min="0"
                />
              </label>
              <button
                type="button"
                onClick={() => remover(linha.chave)}
                className="rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50"
              >
                Remover
              </button>
            </div>
          ))}
        </div>

        <Button type="button" variant="outline" onClick={adicionar} className="self-start">
          + Adicionar variante
        </Button>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar variantes"}
        </Button>
      </form>
    </Card>
  );
}
