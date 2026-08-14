import { CheckCircleIcon, AlertTriangleIcon, TrendingUpIcon } from "@/components/icons";

// Medidor visual de margem de faturamento (Lucro/Faturado) — inspirado no
// gauge de "margem %" da planilha real de controle de uma gráfica cliente
// (ver AGENTS/tarefa de relatórios em Meu Negócio). Em vez de um gauge
// circular em SVG, é uma barra horizontal com 3 faixas de referência
// (ruim/médio/bom) e um marcador na posição da margem atual — comunica
// "essa margem é boa ou ruim" visualmente, não só o número cru, com o mesmo
// espírito artesanal do Sparkline/ProportionBar já usados no projeto (sem
// lib de gráfico nova).
//
// Limiares (10% / 25%) são um ponto de partida de referência do setor
// gráfico, não uma regra de negócio configurável — se o dono achar que
// deveriam ser outros números, é ajuste de UI, não dado de nenhuma tabela.
const LIMIAR_RUIM = 10;
const LIMIAR_BOM = 25;
const ESCALA_MIN = -20;
const ESCALA_MAX = 50;

function clamp(valor: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, valor));
}

function paraPercentualNaEscala(valor: number): number {
  return ((clamp(valor, ESCALA_MIN, ESCALA_MAX) - ESCALA_MIN) / (ESCALA_MAX - ESCALA_MIN)) * 100;
}

function classificar(margem: number): {
  rotulo: string;
  corTexto: string;
  corMarcador: string;
  icone: React.ReactNode;
} {
  if (margem < LIMIAR_RUIM) {
    return {
      rotulo: "Margem baixa",
      corTexto: "text-rose-600 dark:text-rose-400",
      corMarcador: "bg-rose-600 dark:bg-rose-500",
      icone: <AlertTriangleIcon className="h-4 w-4" />,
    };
  }
  if (margem < LIMIAR_BOM) {
    return {
      rotulo: "Margem média",
      corTexto: "text-amber-600 dark:text-amber-400",
      corMarcador: "bg-amber-600 dark:bg-amber-500",
      icone: <TrendingUpIcon className="h-4 w-4" />,
    };
  }
  return {
    rotulo: "Boa margem",
    corTexto: "text-emerald-600 dark:text-emerald-400",
    corMarcador: "bg-emerald-600 dark:bg-emerald-500",
    icone: <CheckCircleIcon className="h-4 w-4" />,
  };
}

export function MedidorMargem({ margem }: { margem: number | null }) {
  const inicioMedio = paraPercentualNaEscala(LIMIAR_RUIM);
  const inicioBom = paraPercentualNaEscala(LIMIAR_BOM);

  if (margem === null) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-slate-500">
          Sem faturamento no período — não dá pra calcular margem.
        </p>
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }

  const classificacao = classificar(margem);
  const posicaoMarcador = paraPercentualNaEscala(margem);

  return (
    <div className="flex flex-col gap-2">
      <div className={`flex items-center gap-1.5 text-sm font-medium ${classificacao.corTexto}`}>
        {classificacao.icone}
        {classificacao.rotulo}
        <span className="text-slate-900 dark:text-white">
          · {margem.toFixed(1).replace(".", ",")}%
        </span>
      </div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div
          className="absolute inset-y-0 left-0 bg-rose-200 dark:bg-rose-950"
          style={{ width: `${inicioMedio}%` }}
        />
        <div
          className="absolute inset-y-0 bg-amber-200 dark:bg-amber-950"
          style={{ left: `${inicioMedio}%`, width: `${inicioBom - inicioMedio}%` }}
        />
        <div
          className="absolute inset-y-0 bg-emerald-200 dark:bg-emerald-950"
          style={{ left: `${inicioBom}%`, width: `${100 - inicioBom}%` }}
        />
        <div
          className={`absolute inset-y-0 w-1 rounded-full ring-2 ring-white dark:ring-slate-900 ${classificacao.corMarcador}`}
          style={{ left: `calc(${posicaoMarcador}% - 2px)` }}
          title={`Margem atual: ${margem.toFixed(1).replace(".", ",")}%`}
        />
      </div>
      <div className="flex justify-between text-[11px] text-slate-400">
        <span>Ruim (abaixo de {LIMIAR_RUIM}%)</span>
        <span>Média</span>
        <span>Boa (acima de {LIMIAR_BOM}%)</span>
      </div>
    </div>
  );
}
