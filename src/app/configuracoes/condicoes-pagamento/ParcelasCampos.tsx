"use client";

import { Button } from "@/components/ui/Button";

export type LinhaParcela = { chave: string; percentual: string; diasAposAncora: string };

// Editor de linhas de parcela (percentual + dias após a âncora) compartilhado
// entre NovaCondicaoPagamentoForm.tsx e [id]/CondicaoPagamentoForm.tsx —
// mesmo padrão de lista editável via campo hidden JSON.stringify de
// TabelaGramaturaForm.tsx (src/app/catalogo/[itemGraficaId]), só extraído em
// componente próprio porque os dois forms (criar/editar) precisam da mesma
// lógica de add/editar/remover linha. A ordem da parcela (1ª, 2ª...) é a
// posição na lista, não um campo digitado — mesmo espírito de simplicidade
// da tabela de gramatura.
export function ParcelasCampos({
  linhas,
  atualizar,
  remover,
  adicionar,
}: {
  linhas: LinhaParcela[];
  atualizar: (chave: string, campo: "percentual" | "diasAposAncora", valor: string) => void;
  remover: (chave: string) => void;
  adicionar: () => void;
}) {
  const somaPercentual = linhas.reduce((soma, linha) => soma + (Number(linha.percentual) || 0), 0);
  // Tolerância de 0.01 pra casos tipo 33.34+33.33+33.33 (arredondamento de
  // 1/3) — mesma tolerância validada no server em lerParcelas (actions.ts).
  const somaFecha = linhas.length > 0 && Math.abs(somaPercentual - 100) <= 0.01;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-slate-500">Parcelas</span>
        <span
          className={`text-xs font-medium ${somaFecha ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
        >
          Soma: {somaPercentual.toFixed(2)}%{!somaFecha && " — precisa fechar 100%"}
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {linhas.map((linha, indice) => (
          <div key={linha.chave} className="flex items-end gap-3">
            <span className="w-6 shrink-0 pb-2.5 text-xs text-slate-400">{indice + 1}ª</span>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-slate-500">Percentual (%)</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="100"
                value={linha.percentual}
                onChange={(e) => atualizar(linha.chave, "percentual", e.target.value)}
                placeholder="ex: 50"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs text-slate-500">Dias após a âncora</span>
              <input
                type="number"
                step="1"
                min="0"
                value={linha.diasAposAncora}
                onChange={(e) => atualizar(linha.chave, "diasAposAncora", e.target.value)}
                placeholder="ex: 30"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
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
        + Adicionar parcela
      </Button>
    </div>
  );
}
