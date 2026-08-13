"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { previsaoBaixaEstoque, type PrevisaoBaixaEstoqueResult } from "./actions";

type ItemPrevisao = Extract<PrevisaoBaixaEstoqueResult, { ok: true }>["itens"][number];

type Estado =
  | { tipo: "idle" }
  | { tipo: "carregando" }
  | { tipo: "erro"; mensagem: string }
  | { tipo: "confirmando"; itens: ItemPrevisao[] };

// Estado + chamada de previsaoBaixaEstoque isolados num hook próprio pra
// PedidoLinha.tsx poder colocar o gatilho (inline, na linha de botões) e o
// painel de confirmação (bloco largo, abaixo da linha inteira) em lugares
// diferentes da árvore — mesma separação que o cancelamento de pedido já usa
// entre o botão "Cancelar" e o bloco ConfirmarExclusao.
export function useIniciarImpressao(pedidoId: string) {
  const [estado, setEstado] = useState<Estado>({ tipo: "idle" });

  const iniciar = async () => {
    setEstado({ tipo: "carregando" });
    const resultado = await previsaoBaixaEstoque(pedidoId);
    if (!resultado.ok) {
      setEstado({ tipo: "erro", mensagem: resultado.mensagem });
      return;
    }
    setEstado({ tipo: "confirmando", itens: resultado.itens });
  };

  const cancelar = () => setEstado({ tipo: "idle" });

  return { estado, iniciar, cancelar };
}

export function IniciarImpressaoBotao({
  estado,
  onIniciar,
}: {
  estado: Estado;
  onIniciar: () => void;
}) {
  if (estado.tipo === "confirmando") return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="outline" loading={estado.tipo === "carregando"} onClick={onIniciar}>
        Iniciar impressão
      </Button>
      {estado.tipo === "erro" && <span className="text-xs text-rose-600">{estado.mensagem}</span>}
    </div>
  );
}

export function PainelConfirmacaoImpressao({
  pedidoId,
  itens,
  formAction,
  isPending,
  erroSubmit,
  onCancelar,
}: {
  pedidoId: string;
  itens: ItemPrevisao[];
  formAction: (formData: FormData) => void;
  isPending: boolean;
  erroSubmit?: string;
  onCancelar: () => void;
}) {
  const [perdas, setPerdas] = useState<Record<string, string>>(() =>
    Object.fromEntries(itens.map((i) => [i.chave, String(i.perdaPadrao)]))
  );

  // Só pra destacar visualmente quando o mesmo material aparece em mais de um
  // produto do pedido — cada linha continua editável e independente, o
  // usuário decide caso a caso se mantém a perda em cada uma ou zera as
  // repetidas (não existe um "modo" especial, é só uma pista visual).
  const contagemPorMaterial = itens.reduce<Record<string, number>>((acc, item) => {
    const chaveMaterial = `${item.materiaPrimaNome}::${item.varianteRotulo ?? ""}`;
    acc[chaveMaterial] = (acc[chaveMaterial] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-800 dark:bg-slate-800/30">
      <div>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
          Confirmar início de impressão
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          O consumo pela ficha técnica não é editável aqui. A perda fixa de calibragem vem
          pré-preenchida com o padrão cadastrado do material — ajuste se este pedido for diferente.
        </p>
      </div>

      {itens.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nenhum material com controle de estoque neste pedido — pode confirmar direto.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {itens.map((item) => {
            const chaveMaterial = `${item.materiaPrimaNome}::${item.varianteRotulo ?? ""}`;
            const repetido = (contagemPorMaterial[chaveMaterial] ?? 0) > 1;
            return (
              <div
                key={item.chave}
                className={`flex flex-wrap items-end gap-3 rounded-xl border px-3 py-2 ${
                  repetido
                    ? "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20"
                    : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                }`}
              >
                <div className="flex-1 text-sm">
                  <p className="font-medium text-slate-800 dark:text-slate-100">
                    {item.materiaPrimaNome}
                    {item.varianteRotulo ? ` (${item.varianteRotulo})` : ""}
                  </p>
                  {repetido && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Material repetido neste pedido — zere aqui se quiser contar a perda só uma vez.
                    </p>
                  )}
                </div>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">Consumo (ficha técnica)</span>
                  <span className="flex w-24 items-center px-2 py-1.5 text-sm text-slate-500">
                    {item.quantidadeConsumida}
                  </span>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-slate-500">Perda fixa de calibragem</span>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={perdas[item.chave] ?? ""}
                    onChange={(e) =>
                      setPerdas((atual) => ({ ...atual, [item.chave]: e.target.value }))
                    }
                    className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-900 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </label>
              </div>
            );
          })}
        </div>
      )}

      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="pedidoId" value={pedidoId} />
        <input
          type="hidden"
          name="perdasJson"
          value={JSON.stringify(
            itens.map((item) => ({
              chave: item.chave,
              perdaAplicada: Number(perdas[item.chave] || 0),
            }))
          )}
        />
        <Button type="submit" loading={isPending}>
          {isPending ? "Iniciando..." : "Confirmar e iniciar impressão"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancelar}>
          Cancelar
        </Button>
        {erroSubmit && <span className="text-xs text-rose-600">{erroSubmit}</span>}
      </form>
    </div>
  );
}
