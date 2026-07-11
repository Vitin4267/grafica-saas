"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { gerarChave } from "@/lib/chave-local";
import { salvarTabelaGramatura } from "./actions";

type LinhaGramatura = { chave: string; gramatura: string; precoKg: string };

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

export function TabelaGramaturaForm({
  itemGraficaId,
  linhasIniciais,
}: {
  itemGraficaId: string;
  linhasIniciais: { gramatura: string; precoKg: string }[];
}) {
  const [linhas, setLinhas] = useState<LinhaGramatura[]>(() =>
    linhasIniciais.length > 0
      ? linhasIniciais.map((l) => ({ chave: gerarChave(), ...l }))
      : [{ chave: gerarChave(), gramatura: "", precoKg: "" }]
  );
  const [state, formAction, isPending] = useActionState(salvarTabelaGramatura, null);

  const atualizar = (chave: string, campo: "gramatura" | "precoKg", valor: string) => {
    setLinhas((atual) => atual.map((l) => (l.chave === chave ? { ...l, [campo]: valor } : l)));
  };
  const remover = (chave: string) => setLinhas((atual) => atual.filter((l) => l.chave !== chave));
  const adicionar = () =>
    setLinhas((atual) => [...atual, { chave: gerarChave(), gramatura: "", precoKg: "" }]);

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
          Gramaturas e preço por kg
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Este papel vira um único item no catálogo — cada gramatura é uma linha aqui, não um
          cadastro novo. Produtos Offset escolhem este papel e uma gramatura; se digitarem uma
          gramatura fora desta lista, o sistema usa o preço da mais próxima automaticamente.
        </p>
      </div>

      <form
        action={formAction}
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          if (linhas.some((l) => !l.gramatura || !l.precoKg)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
        <input
          type="hidden"
          name="tabelaJson"
          value={JSON.stringify(
            linhas
              .filter((l) => l.gramatura && l.precoKg)
              .map(({ gramatura, precoKg }) => ({ gramatura, precoKg }))
          )}
        />

        <div className="flex flex-col gap-3">
          {linhas.map((linha) => (
            <div key={linha.chave} className="flex items-end gap-3">
              <label className="flex w-32 flex-col gap-1">
                <span className="text-xs text-slate-500">Gramatura (g/m²)</span>
                <CampoLinha
                  value={linha.gramatura}
                  onChange={(v) => atualizar(linha.chave, "gramatura", v)}
                  placeholder="ex: 150"
                  step="1"
                  min="30"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs text-slate-500">Preço por kg (R$)</span>
                <CampoLinha
                  value={linha.precoKg}
                  onChange={(v) => atualizar(linha.chave, "precoKg", v)}
                  placeholder="ex: 13.40"
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
          + Adicionar gramatura
        </Button>

        {state && <Alert variant={state.ok ? "success" : "error"}>{state.mensagem}</Alert>}

        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Salvando..." : "Salvar gramaturas"}
        </Button>
      </form>
    </Card>
  );
}
