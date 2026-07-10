export type FaixaProporcao = {
  chave: string;
  rotulo: string;
  quantidade: number;
  corClasse: string;
};

// Barras de proporção lado a lado (uma por status) — cada linha sempre mostra o
// rótulo e a contagem em texto, nunca só a cor, então a informação não depende
// de diferenciar tons (importante pra quem tem daltonismo).
export function ProportionBar({
  faixas,
  total,
}: {
  faixas: FaixaProporcao[];
  total: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      {faixas.map((faixa) => {
        const percentual = total > 0 ? Math.round((faixa.quantidade / total) * 100) : 0;
        return (
          <div key={faixa.chave} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-700 dark:text-slate-200">{faixa.rotulo}</span>
              <span className="font-medium text-slate-900 dark:text-white">
                {faixa.quantidade}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full transition-all ${faixa.corClasse}`}
                style={{ width: `${percentual}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
