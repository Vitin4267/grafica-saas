import { Card } from "@/components/ui/Card";
import { formatoMoeda } from "@/lib/moeda";
import type { ComparacaoCustoPedido } from "@/lib/custo-producao";

export function CustoProducaoCard({ comparacao }: { comparacao: ComparacaoCustoPedido }) {
  const diferenca = comparacao.totalReal - comparacao.totalOrcado;
  const estourou = diferenca > 0.005; // tolerância de arredondamento

  return (
    <Card className="mb-6 p-5">
      <p className="mb-4 text-sm font-medium text-slate-500">
        Custo de produção: orçado vs. real
      </p>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              <th className="pb-2 font-medium">Matéria-prima</th>
              <th className="pb-2 font-medium">Qtd. orçada</th>
              <th className="pb-2 font-medium">Custo orçado</th>
              <th className="pb-2 font-medium">Qtd. real</th>
              <th className="pb-2 font-medium">Custo real</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {comparacao.itens.map((item) => (
              <tr key={item.materiaPrimaId}>
                <td className="py-2 pr-2 text-slate-800 dark:text-slate-100">{item.nome}</td>
                <td className="py-2 pr-2 text-slate-600 dark:text-slate-300">
                  {item.quantidadeOrcada.toFixed(3)}
                </td>
                <td className="py-2 pr-2 text-slate-600 dark:text-slate-300">
                  {formatoMoeda.format(item.custoOrcado)}
                </td>
                <td className="py-2 pr-2 text-slate-600 dark:text-slate-300">
                  {item.quantidadeReal.toFixed(3)}
                </td>
                <td className="py-2 text-slate-600 dark:text-slate-300">
                  {formatoMoeda.format(item.custoReal)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4 dark:border-slate-800">
        <p className="text-sm font-medium text-slate-500">
          Total: {formatoMoeda.format(comparacao.totalOrcado)} orçado ·{" "}
          {formatoMoeda.format(comparacao.totalReal)} real
        </p>
        <p
          className={`text-sm font-semibold ${
            estourou
              ? "text-rose-600 dark:text-rose-400"
              : "text-emerald-600 dark:text-emerald-400"
          }`}
        >
          {diferenca > 0 ? "+" : ""}
          {formatoMoeda.format(diferenca)}
        </p>
      </div>
    </Card>
  );
}
