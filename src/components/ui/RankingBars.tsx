// Barras horizontais ranqueadas (magnitude por item) — pro relatório de Meu
// Negócio: top clientes, produtos mais vendidos, custos por categoria.
// Diferente de ProportionBar (que soma 100% de um total fixo, ex: funil de
// status): aqui cada barra é escalada pelo MAIOR valor da lista, não por uma
// soma — porque a pergunta é "quem é o maior", não "que fatia do todo".
// Rótulo + valor sempre em texto (nunca só a barra), mesmo princípio de
// acessibilidade do ProportionBar.
export type ItemRanking = {
  chave: string;
  rotulo: string;
  valor: number;
  valorFormatado: string;
  corClasse?: string;
};

// Paleta categórica validada (ver skill de dataviz: CVD ΔE >= 6 em todo par
// adjacente, contraste >= 3:1 no dark, banda de luminosidade ok em ambos os
// modos) — usada pelo gráfico "custos por categoria", que é genuinamente
// multi-série (cada categoria é uma cor própria). Os outros rankings desta
// tela (top clientes, produtos) são série única (uma métrica, itens
// ranqueados) e usam um único tom de destaque, sem precisar de paleta.
// Limitada a 7 tons reais + "Outros" (cinza neutro) além disso — nunca gera
// uma 8ª cor "nova", dobra pro balde Outros (ver dataviz skill,
// anti-padrão de paleta sem teto).
export const CORES_CATEGORICAS = [
  "bg-blue-500 dark:bg-blue-600",
  "bg-orange-500 dark:bg-orange-600",
  "bg-cyan-500 dark:bg-cyan-600",
  "bg-yellow-600 dark:bg-yellow-700",
  "bg-pink-500 dark:bg-pink-600",
  "bg-green-500 dark:bg-green-600",
  "bg-violet-500 dark:bg-violet-600",
];
export const COR_OUTROS = "bg-slate-400 dark:bg-slate-600";

export function RankingBars({
  itens,
  vazio,
}: {
  itens: ItemRanking[];
  vazio?: string;
}) {
  if (itens.length === 0) {
    return <p className="py-2 text-sm text-slate-500">{vazio ?? "Sem dados no período."}</p>;
  }

  const maior = Math.max(...itens.map((i) => Math.abs(i.valor)), 1);

  return (
    <div className="flex flex-col gap-3">
      {itens.map((item, indice) => {
        // Piso de 4% pra barra nunca "sumir" visualmente quando o valor é
        // pequeno perto do maior item da lista — o número ao lado já mostra
        // a magnitude exata.
        const percentual = Math.max(4, Math.round((Math.abs(item.valor) / maior) * 100));
        return (
          <div key={item.chave} className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-slate-700 dark:text-slate-200">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {indice + 1}
                </span>
                <span className="truncate">{item.rotulo}</span>
              </span>
              <span className="shrink-0 font-medium text-slate-900 dark:text-white">
                {item.valorFormatado}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all ${item.corClasse ?? "bg-teal-500 dark:bg-teal-600"}`}
                style={{ width: `${percentual}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
