"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useAoMudar } from "@/lib/hooks/useAoMudar";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { ConfirmarExclusao } from "@/components/ui/ConfirmarExclusao";
import { formatoMoeda } from "@/lib/moeda";
import { lancarCustoPedido, excluirCustoPedido } from "./actions";

type Custo = {
  id: string;
  categoriaNome: string;
  // null quando o usuário não tem CUSTOS.podeVer (ver prop podeVer abaixo) —
  // producao/page.tsx já nem envia o valor real pro client nesse caso, isso
  // aqui é a segunda trava (renderização), não a única.
  valor: number | null;
  observacao: string | null;
  createdAt: string;
};

// Mesmo padrão de LinhaPagamento (src/app/orcamento/[id]/PagamentosCard.tsx):
// linha própria com seu useActionState de exclusão, pra cada item poder
// confirmar/excluir sem afetar o estado dos irmãos.
function LinhaCusto({
  custo,
  podeEditarCustos,
  podeVer,
}: {
  custo: Custo;
  podeEditarCustos: boolean;
  // Controla só a EXIBIÇÃO do valor/categoria — quem lança custo sem
  // CUSTOS.podeVer continua podendo excluir o que ELE lançou (podeEditarCustos
  // já garante isso), só não vê quanto os outros lançamentos valem.
  podeVer: boolean;
}) {
  const [state, formAction, isPending] = useActionState(excluirCustoPedido, null);
  const [confirmando, setConfirmando] = useState(false);

  useAoMudar(state, (state) => {
    if (state && !state.ok) setConfirmando(false);
  });

  const valorVisivel = podeVer && custo.valor !== null;

  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {valorVisivel ? (
              <>
                {formatoMoeda.format(custo.valor as number)}
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {custo.categoriaNome}
                </span>
              </>
            ) : (
              custo.categoriaNome
            )}
          </p>
          <p className="text-xs text-slate-500">
            {new Date(custo.createdAt).toLocaleDateString("pt-BR")}
            {custo.observacao && ` · ${custo.observacao}`}
          </p>
          {state && !state.ok && <p className="mt-1 text-xs text-rose-600">{state.mensagem}</p>}
        </div>
        {podeEditarCustos && !confirmando && (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className="shrink-0 text-xs font-medium text-rose-600 hover:underline"
          >
            Remover
          </button>
        )}
      </div>
      {confirmando && (
        <ConfirmarExclusao
          pergunta={
            valorVisivel
              ? `Remover o custo de ${formatoMoeda.format(custo.valor as number)} (${custo.categoriaNome})? Essa ação não pode ser desfeita.`
              : `Remover este lançamento de ${custo.categoriaNome}? Essa ação não pode ser desfeita.`
          }
          onCancelar={() => setConfirmando(false)}
          formAction={formAction}
          campos={{ custoId: custo.id }}
          rotuloBotao="Remover custo"
          pendente={isPending}
        />
      )}
    </div>
  );
}

// Seção de custos REAIS lançados no pedido (diferente do custo estimado do
// motor de precificação) + lucro calculado. Fica dentro de um <details>
// (mesmo padrão nativo já usado em UsuariosLista.tsx pra "funcionários
// desativados") — um único clique expande, nunca fica escondida atrás de
// mais de um clique como pedido pela tarefa.
export function CustosPedidoSecao({
  pedidoId,
  categoriasCustoAtivas,
  custos,
  lucro,
  podeEditarCustos,
  podeVer,
}: {
  pedidoId: string;
  categoriasCustoAtivas: { id: string; nome: string }[];
  custos: Custo[];
  // Lucro já calculado do lado do servidor (receita do orçamento − soma dos
  // custos), ver producao/page.tsx — nunca recalculado aqui, pra não
  // duplicar a lógica de src/lib/custo-pedido.ts em dois lugares. Vem null
  // quando ainda não há nenhum custo lançado OU quando o usuário não tem
  // CUSTOS.podeVer (producao/page.tsx já não envia o valor real no 2º caso).
  lucro: number | null;
  // Lançar/excluir custo (CUSTOS.podeEditar). Renomeado de "podeEditar" pra
  // deixar explícito que não é mais sobre PRODUCAO (ver fase-custo-real.md
  // §2.6 / PR-1) — quem só tem isso lança retrabalho sem ver valores.
  podeEditarCustos: boolean;
  // Ver valor de cada custo + lucro do pedido (CUSTOS.podeVer).
  podeVer: boolean;
}) {
  const [state, formAction, isPending] = useActionState(lancarCustoPedido, null);

  return (
    <details className="group rounded-xl border border-slate-200 dark:border-slate-800">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-600 marker:content-none hover:bg-slate-50 dark:text-slate-300 dark:hover:bg-slate-800/50">
        <span>Custos{custos.length > 0 && ` (${custos.length})`}</span>
        {podeVer && lucro !== null && (
          <span
            className={`text-sm font-semibold ${
              lucro >= 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-rose-600 dark:text-rose-400"
            }`}
          >
            Lucro deste pedido: {formatoMoeda.format(lucro)}
          </span>
        )}
      </summary>

      <div className="flex flex-col gap-3 border-t border-slate-100 p-4 dark:border-slate-800">
        {custos.length > 0 && (
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {custos.map((custo) => (
              <LinhaCusto key={custo.id} custo={custo} podeEditarCustos={podeEditarCustos} podeVer={podeVer} />
            ))}
          </div>
        )}

        {podeEditarCustos &&
          (categoriasCustoAtivas.length > 0 ? (
            <form action={formAction} className="flex flex-col gap-3">
              <input type="hidden" name="pedidoId" value={pedidoId} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Select
                  label="Categoria"
                  name="categoriaCustoId"
                  defaultValue={categoriasCustoAtivas[0].id}
                >
                  {categoriasCustoAtivas.map((categoria) => (
                    <option key={categoria.id} value={categoria.id}>
                      {categoria.nome}
                    </option>
                  ))}
                </Select>
                <Input label="Valor (R$)" name="valor" type="number" step="0.01" min="0.01" required />
                <Input label="Observação (opcional)" name="observacao" />
              </div>
              {state && !state.ok && <Alert variant="error">{state.mensagem}</Alert>}
              <Button type="submit" variant="outline" loading={isPending} className="self-start">
                {isPending ? "Lançando..." : "Lançar custo"}
              </Button>
            </form>
          ) : (
            <p className="text-xs text-slate-500">
              Nenhuma categoria de custo ativa —{" "}
              <Link
                href="/configuracoes/categorias-custo"
                className="text-teal-700 hover:underline dark:text-teal-400"
              >
                configure em Configurações
              </Link>
              .
            </p>
          ))}
      </div>
    </details>
  );
}
