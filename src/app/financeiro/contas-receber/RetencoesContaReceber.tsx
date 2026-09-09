"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { formatoMoeda } from "@/lib/moeda";
import { ORDEM_TRIBUTO_RETIDO, ROTULO_TRIBUTO_RETIDO } from "@/lib/retencao-conta-receber";
import { criarRetencaoContaReceber, excluirRetencaoContaReceber } from "./actions";

type Retencao = {
  id: string;
  tributo: string;
  tributoOutro: string | null;
  percentual: string;
  valor: string;
};

// Achado A9 da Parte 4 da auditoria de abrangência (2026-09-09) — versão
// DECLARATIVA apenas: mostra bruto/retenções/líquido esperado como
// informação e deixa a gráfica registrar cada tributo retido, mas NUNCA
// muda o formulário de baixa acima (ver ContaReceberLinha.tsx) nem o
// critério de "conta paga integralmente" — quem recebe só o líquido
// continua precisando registrar uma baixa PARCIAL manual (achado A8) pra
// fechar a conta, como já era possível antes deste componente existir.
export function RetencoesContaReceber({
  contaReceberId,
  valorBruto,
  valorRetencoes,
  retencoes,
  podeEditar,
}: {
  contaReceberId: string;
  valorBruto: number;
  valorRetencoes: number;
  retencoes: Retencao[];
  podeEditar: boolean;
}) {
  const [estadoCriar, acaoCriar, criando] = useActionState(criarRetencaoContaReceber, null);
  const [, acaoExcluir] = useActionState(excluirRetencaoContaReceber, null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [tributo, setTributo] = useState<string>(ORDEM_TRIBUTO_RETIDO[0]);

  useAoMudar(estadoCriar, (estado) => {
    if (estado?.ok) {
      setMostrarForm(false);
      setTributo(ORDEM_TRIBUTO_RETIDO[0]);
    }
  });

  const liquido = valorBruto - valorRetencoes;

  return (
    <div className="mt-3 rounded-lg border border-dashed border-slate-200 p-3 text-xs dark:border-slate-700">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-600 dark:text-slate-300">
        <span>
          Bruto: <strong className="text-slate-800 dark:text-slate-100">{formatoMoeda.format(valorBruto)}</strong>
        </span>
        <span>
          Retenções:{" "}
          <strong className="text-slate-800 dark:text-slate-100">{formatoMoeda.format(valorRetencoes)}</strong>
        </span>
        <span>
          Líquido esperado:{" "}
          <strong className="text-slate-800 dark:text-slate-100">{formatoMoeda.format(liquido)}</strong>
        </span>
      </div>

      {retencoes.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1">
          {retencoes.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2">
              <span className="text-slate-600 dark:text-slate-300">
                {ROTULO_TRIBUTO_RETIDO[r.tributo as keyof typeof ROTULO_TRIBUTO_RETIDO] ?? r.tributo}
                {r.tributo === "OUTRO" && r.tributoOutro ? ` (${r.tributoOutro})` : ""} —{" "}
                {formatoMoeda.format(Number(r.valor))} ({Number(r.percentual)}%)
              </span>
              {podeEditar && (
                <form action={acaoExcluir}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className="font-medium text-rose-600 hover:underline">
                    Remover
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {podeEditar &&
        (mostrarForm ? (
          <form action={acaoCriar} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
            <input type="hidden" name="contaReceberId" value={contaReceberId} />
            <Select
              label="Tributo"
              name="tributo"
              value={tributo}
              onChange={(e) => setTributo(e.target.value)}
              className="!py-1.5 text-xs"
            >
              {ORDEM_TRIBUTO_RETIDO.map((valor) => (
                <option key={valor} value={valor}>
                  {ROTULO_TRIBUTO_RETIDO[valor]}
                </option>
              ))}
            </Select>
            {tributo === "OUTRO" && (
              <Input label="Descreva" name="tributoOutro" placeholder="ex: contribuição sindical" required className="w-32 !py-1.5 text-xs" />
            )}
            <Input
              label="Percentual (%)"
              name="percentual"
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="ex: 1,50"
              required
              className="w-24 !py-1.5 text-xs"
            />
            <Input
              label="Valor retido (R$)"
              name="valor"
              type="number"
              step="0.01"
              min="0.01"
              required
              className="w-28 !py-1.5 text-xs"
            />
            <Button type="submit" variant="outline" loading={criando}>
              {criando ? "Registrando..." : "Registrar"}
            </Button>
            <button
              type="button"
              onClick={() => setMostrarForm(false)}
              className="text-slate-500 hover:underline"
            >
              Cancelar
            </button>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => setMostrarForm(true)}
            className="mt-2 font-medium text-teal-700 hover:underline dark:text-teal-400"
          >
            + Registrar retenção de imposto
          </button>
        ))}
      {estadoCriar && !estadoCriar.ok && <p className="mt-1 text-rose-600">{estadoCriar.mensagem}</p>}
    </div>
  );
}
