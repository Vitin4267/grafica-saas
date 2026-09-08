"use client";

import { useActionState, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatoMoeda } from "@/lib/moeda";
import { lancarProducaoEspeculativa } from "./actions";

type LinhaFicha = {
  materiaPrimaNome: string;
  varianteRotulo: string | null;
  quantidadePorUnidade: string;
  unidadeRotulo: string;
  precoCompra: string | null;
  estoqueAtual: string | null;
};

// Estoque de produto pré-produzido (2026-09-08) — form "Pré-produzir X
// unidades", mesmo estilo visual de LancarMovimentacaoForm.tsx ao lado, mas
// sem os 3 tipos de movimentação: só quantidade a produzir. A prévia de
// consumo/custo abaixo é calculada 100% no client a partir da ficha técnica
// já carregada (mesmo espírito de PainelConfirmacaoImpressao, mas sem
// round-trip ao servidor — pré-produção nunca usa o motor de substrato
// avançado, ver comentário em src/lib/pre-producao-estoque.ts, então o
// consumo é sempre linear e dá pra calcular aqui mesmo). A baixa DE VERDADE
// (CAS, snapshot de custo) só acontece no servidor, em
// producirEstoqueEspeculativo — esta prévia é só informativa.
export function PreProducaoForm({
  itemGraficaId,
  nomeItem,
  unidadeRotulo,
  estoqueAtual,
  fichaTecnica,
}: {
  itemGraficaId: string;
  nomeItem: string;
  unidadeRotulo: string;
  estoqueAtual: string;
  fichaTecnica: LinhaFicha[];
}) {
  const [quantidade, setQuantidade] = useState("");
  const [estado, action, isPending] = useActionState(lancarProducaoEspeculativa, null);

  const quantidadeNum = Number(quantidade);
  const quantidadeValida = quantidade !== "" && Number.isFinite(quantidadeNum) && quantidadeNum > 0;

  const previa = quantidadeValida
    ? fichaTecnica.map((linha) => {
        const necessaria = Number(linha.quantidadePorUnidade) * quantidadeNum;
        const custo = linha.precoCompra !== null ? Number(linha.precoCompra) * necessaria : null;
        const insuficiente = linha.estoqueAtual !== null && necessaria > Number(linha.estoqueAtual);
        return { ...linha, necessaria, custo, insuficiente };
      })
    : [];
  const custoTotalPrevia = previa.some((l) => l.custo !== null)
    ? previa.reduce((soma, l) => soma + (l.custo ?? 0), 0)
    : null;
  const algumInsuficiente = previa.some((l) => l.insuficiente);

  return (
    <Card className="flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">
          Estoque pré-produzido
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Fabrique este produto especulativamente, antes de qualquer pedido — a matéria-prima é
          descontada pela ficha técnica na hora, e o resultado fica pronto em estoque
          ({estoqueAtual || "0"} {unidadeRotulo} agora) pra atender um pedido futuro sem rodar produção
          do zero.
        </p>
      </div>

      {fichaTecnica.length === 0 ? (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Este produto ainda não tem ficha técnica cadastrada — pré-produzir vai só somar ao
          estoque pronto, sem descontar nenhuma matéria-prima nem apurar custo. Cadastre a ficha
          técnica acima pra rastrear o consumo corretamente.
        </p>
      ) : null}

      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="itemGraficaId" value={itemGraficaId} />
        <div className="w-40">
          <Input
            label={`Quantidade a produzir${unidadeRotulo ? ` (${unidadeRotulo})` : ""}`}
            name="quantidade"
            type="number"
            step="0.0001"
            min="0"
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            required
          />
        </div>

        {previa.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-slate-500">
              Prévia do consumo de matéria-prima
            </p>
            {previa.map((linha, i) => (
              <div
                key={i}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
                  linha.insuficiente
                    ? "border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20"
                    : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                }`}
              >
                <span className="text-slate-800 dark:text-slate-100">
                  {linha.materiaPrimaNome}
                  {linha.varianteRotulo ? ` (${linha.varianteRotulo})` : ""}
                </span>
                <span className="text-right text-slate-600 dark:text-slate-300">
                  {linha.necessaria.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}{" "}
                  {linha.unidadeRotulo}
                  {linha.custo !== null && ` · ${formatoMoeda.format(linha.custo)}`}
                  {linha.insuficiente && (
                    <span className="ml-1 font-medium text-rose-600 dark:text-rose-400">
                      estoque insuficiente
                    </span>
                  )}
                </span>
              </div>
            ))}
            {custoTotalPrevia !== null && (
              <p className="text-sm text-slate-700 dark:text-slate-200">
                Custo estimado de matéria-prima:{" "}
                <span className="font-semibold text-slate-900 dark:text-white">
                  {formatoMoeda.format(custoTotalPrevia)}
                </span>
              </p>
            )}
            {algumInsuficiente && (
              <p className="text-xs text-rose-600 dark:text-rose-400">
                Pelo menos uma matéria-prima não tem saldo suficiente pra esta quantidade — a
                confirmação abaixo vai ser recusada sem descontar nada.
              </p>
            )}
          </div>
        )}

        {estado && <Alert variant={estado.ok ? "success" : "error"}>{estado.mensagem}</Alert>}
        <Button type="submit" loading={isPending} className="self-start">
          {isPending ? "Produzindo..." : "Confirmar produção especulativa"}
        </Button>
      </form>
    </Card>
  );
}
