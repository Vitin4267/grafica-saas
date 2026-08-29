"use client";

import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { formatoMoeda } from "@/lib/moeda";
import { aplicarDescontoItemOrcamento } from "./actions";

type TipoDesconto = "PERCENTUAL" | "VALOR_ABSOLUTO" | "PRECO_FINAL";

const ROTULO_TIPO: Record<TipoDesconto, string> = {
  PERCENTUAL: "Percentual (%)",
  VALOR_ABSOLUTO: "Valor por unidade (R$)",
  PRECO_FINAL: "Preço final por unidade (R$)",
};

// Card de "preço sugerido vs. negociado" no card de cada item do orçamento
// (ver fase-custo-real.md §4.2). Só renderizado pelo pai enquanto o
// orçamento está em RASCUNHO — mesma regra do resto dos itens. Item sem
// precoSugeridoUnitario (criado antes desta funcionalidade) mostra uma nota
// curta em vez do formulário: "renderiza normalmente" (critério de aceite),
// só não deixa negociar até o item ser recriado.
export function DescontoItemForm({
  orcamentoItemId,
  precoSugeridoUnitario,
  precoUnitarioAtual,
  descontoTipo,
  descontoValor,
  motivoDesconto,
  aprovadoPorId,
  // Achado A6 da Parte 5 da auditoria de abrangência —
  // Cliente.descontoPadraoPercent, já convertido pro pai pra escala 0-100
  // (mesma escala do campo "Valor (%)" abaixo). Só uma SUGESTÃO de
  // preenchimento: pré-preenche o campo quando o usuário abre o form pela
  // primeira vez (sem desconto ativo ainda), nunca é aplicado sozinho — quem
  // manda é sempre "Aplicar desconto", que passa pela mesma trava de
  // descontoMaxSemAprovacao de sempre.
  descontoPadraoPercentSugerido = null,
}: {
  orcamentoItemId: string;
  precoSugeridoUnitario: string | null;
  precoUnitarioAtual: string;
  descontoTipo: TipoDesconto | null;
  descontoValor: string | null;
  motivoDesconto: string | null;
  aprovadoPorId: string | null;
  descontoPadraoPercentSugerido?: number | null;
}) {
  const [state, formAction, isPending] = useActionState(aplicarDescontoItemOrcamento, null);
  const [estadoRemocao, acaoRemover, removendoPending] = useActionState(
    aplicarDescontoItemOrcamento,
    null
  );
  const [tipo, setTipo] = useState<TipoDesconto>(descontoTipo ?? "PERCENTUAL");
  const [mostrarForm, setMostrarForm] = useState(false);

  useAoMudar(state, (estado) => {
    if (estado?.ok) setMostrarForm(false);
  });

  if (precoSugeridoUnitario === null) {
    return (
      <p className="px-1 text-xs text-slate-400">
        Preço negociado indisponível — este item foi criado antes desta funcionalidade.
      </p>
    );
  }

  const sugerido = Number(precoSugeridoUnitario);
  const atual = Number(precoUnitarioAtual);
  const temDesconto = descontoTipo !== null;
  const percentualEfetivo = sugerido > 0 ? ((sugerido - atual) / sugerido) * 100 : 0;

  return (
    <Card className="mb-4 -mt-2 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="text-slate-500">Preço sugerido (motor)</span>
        <span className="font-medium text-slate-700 dark:text-slate-200">
          {formatoMoeda.format(sugerido)} / un.
        </span>
      </div>

      {temDesconto && (
        <div className="mt-3 flex flex-col gap-1 rounded-xl bg-amber-50 p-3 text-sm dark:bg-amber-950/30">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-slate-600 dark:text-slate-300">Preço negociado</span>
            <span className="font-semibold text-slate-900 dark:text-white">
              {formatoMoeda.format(atual)} / un.{" "}
              <span className="font-normal text-rose-600 dark:text-rose-400">
                ({percentualEfetivo >= 0 ? "−" : "+"}
                {Math.abs(percentualEfetivo).toFixed(1)}%)
              </span>
            </span>
          </div>
          {motivoDesconto && (
            <p className="text-xs text-slate-500">Motivo: {motivoDesconto}</p>
          )}
          {aprovadoPorId && (
            <p className="text-xs text-slate-500">Desconto acima do limite — aprovação registrada.</p>
          )}
          <form action={acaoRemover} className="mt-1">
            <input type="hidden" name="orcamentoItemId" value={orcamentoItemId} />
            <input type="hidden" name="remover" value="true" />
            <Button
              type="submit"
              variant="ghost"
              loading={removendoPending}
              className="h-auto px-0 py-0 text-xs font-medium text-rose-600 hover:underline"
            >
              Remover desconto — voltar ao preço sugerido
            </Button>
          </form>
        </div>
      )}

      {estadoRemocao && !estadoRemocao.ok && (
        <div className="mt-3">
          <Alert variant="error">{estadoRemocao.mensagem}</Alert>
        </div>
      )}

      {!mostrarForm ? (
        <button
          type="button"
          onClick={() => setMostrarForm(true)}
          className="mt-3 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400"
        >
          {temDesconto ? "Alterar desconto" : "Negociar preço"}
        </button>
      ) : (
        <form action={formAction} className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="orcamentoItemId" value={orcamentoItemId} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Select
              label="Tipo de desconto"
              name="tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as TipoDesconto)}
            >
              {Object.entries(ROTULO_TIPO).map(([valor, rotulo]) => (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              ))}
            </Select>
            <Input
              label={tipo === "PERCENTUAL" ? "Valor (%)" : "Valor (R$)"}
              name="valor"
              type="number"
              step="0.01"
              min={0}
              required
              defaultValue={
                descontoTipo === tipo && descontoValor
                  ? Number(descontoValor).toString()
                  : tipo === "PERCENTUAL" && descontoPadraoPercentSugerido !== null
                    ? descontoPadraoPercentSugerido.toString()
                    : undefined
              }
              hint={
                descontoTipo !== tipo && tipo === "PERCENTUAL" && descontoPadraoPercentSugerido !== null
                  ? "Pré-preenchido com o desconto padrão cadastrado no cliente"
                  : undefined
              }
            />
          </div>
          <Input
            label="Motivo do desconto"
            name="motivo"
            required
            defaultValue={motivoDesconto ?? ""}
            placeholder="ex: fechamento de contrato anual"
          />

          {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}

          <div className="flex items-center gap-2">
            <Button type="submit" loading={isPending} variant="outline">
              {isPending ? "Aplicando..." : "Aplicar desconto"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMostrarForm(false)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
