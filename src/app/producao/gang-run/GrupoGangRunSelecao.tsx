"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { combinarGangRun } from "./actions";
import type { GrupoGangRunListado } from "@/lib/gang-run-servico";

// Uma chave física (achado F1: papel+gramatura+prensa+folha+cores no
// FOLHA_2D/Offset, ou material+bobina+máquina no BOBINA_1D/Flexografia) =
// um card com checkbox por candidato — grupo.descricaoCompatibilidade já
// vem formatada certa pro tipoAgrupamento (ver listarFilaGangRunAgrupada
// em src/lib/gang-run-servico.ts). O operador escolhe manualmente quais
// pedidos combinar (MVP não decide isso sozinho, ver comentário de
// GrupoGangRun no schema) — o botão só libera com 2+ marcados, mesmo
// mínimo exigido por combinarGrupoGangRun.
export function GrupoGangRunSelecao({ grupo }: { grupo: GrupoGangRunListado }) {
  const [state, formAction, isPending] = useActionState(combinarGangRun, null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  function alternar(id: string) {
    setSelecionados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) {
        proximo.delete(id);
      } else {
        proximo.add(id);
      }
      return proximo;
    });
  }

  const pronto = grupo.somaFracaoFolha >= 1;
  const percentualFolha = Math.min(grupo.somaFracaoFolha, 1) * 100;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">
            {grupo.descricaoCompatibilidade}
          </h3>
        </div>
        {pronto && (
          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            {grupo.tipoAgrupamento === "FOLHA_2D" ? "Já enche uma chapa" : "Já enche uma rodada de bobina"}
          </span>
        )}
      </div>

      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className={`h-full rounded-full ${pronto ? "bg-emerald-500" : "bg-amber-500"}`}
            style={{ width: `${percentualFolha}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {(grupo.somaFracaoFolha * 100).toFixed(0)}%{" "}
          {grupo.tipoAgrupamento === "FOLHA_2D" ? "de uma folha preenchidos" : "de uma bobina preenchidos"},
          somando os {grupo.candidatos.length} candidatos abaixo.
        </p>
      </div>

      <form action={formAction} className="mt-4">
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {grupo.candidatos.map((candidato) => (
            <li key={candidato.id} className="flex items-center gap-3 py-3">
              <input
                type="checkbox"
                name="filaGangRunIds"
                value={candidato.id}
                checked={selecionados.has(candidato.id)}
                onChange={() => alternar(candidato.id)}
                className="h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 dark:border-slate-700"
              />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/producao#pedido-${candidato.pedidoId}`}
                  className="truncate text-sm font-medium text-slate-900 hover:underline dark:text-white"
                >
                  {candidato.clienteNome}
                </Link>
                <p className="truncate text-xs text-slate-500">{candidato.produtoNome}</p>
              </div>
              <div className="shrink-0 text-right text-xs text-slate-500">
                <p>{candidato.quantidadePeca} un.</p>
                <p>
                  {(candidato.fracaoFolha * 100).toFixed(0)}%{" "}
                  {grupo.tipoAgrupamento === "FOLHA_2D" ? "da folha" : "da bobina"}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            {selecionados.size < 2
              ? "Selecione ao menos dois itens pra combinar."
              : `${selecionados.size} itens selecionados.`}
          </p>
          <Button
            type="submit"
            variant="primary"
            disabled={selecionados.size < 2 || isPending}
            loading={isPending}
          >
            Combinar e mandar pra produção
          </Button>
        </div>

        {state && (
          <p
            className={`mt-2 text-sm ${state.ok ? "text-emerald-600" : "text-rose-600"}`}
          >
            {state.mensagem}
          </p>
        )}
      </form>
    </div>
  );
}
