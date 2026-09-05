import Link from "next/link";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, exigirVerModulo, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatTile } from "@/components/ui/StatTile";
import { ArrowLeftIcon } from "@/components/icons";
import { formatoMoeda } from "@/lib/moeda";
import { anoMesBrasilia, limitesMesBrasilia } from "@/lib/data";
import { buscarDRE } from "@/lib/dre-query";
import type { RegimeDRE } from "@/lib/dre";

// Achado A3 da Parte 4 da auditoria de abrangência (pesquisa-abrangencia-
// modulos.md, 2026-09-05): DRE simplificado com regime explícito por linha —
// ver src/lib/dre.ts pro porquê de cada rótulo CAIXA/COMPETENCIA/MISTO.

const ROTULO_REGIME: Record<RegimeDRE, string> = {
  CAIXA: "Caixa",
  COMPETENCIA: "Competência",
  MISTO: "Misto",
};

const COR_REGIME: Record<RegimeDRE, string> = {
  CAIXA: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  COMPETENCIA: "bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300",
  MISTO: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
};

function formatoPercent(fracao: number | null): string {
  if (fracao === null) return "—";
  return `${(fracao * 100).toFixed(1).replace(".", ",")}%`;
}

export default async function DrePage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "FINANCEIRO");

  const { mes: mesParam } = await searchParams;
  const mesAtual = anoMesBrasilia(new Date());
  const mes =
    mesParam && /^\d{4}-\d{2}$/.test(mesParam)
      ? mesParam
      : `${mesAtual.ano}-${String(mesAtual.mes).padStart(2, "0")}`;
  const [anoStr, mesStr] = mes.split("-");
  const ano = Number(anoStr);
  const mesNumero = Number(mesStr);
  const { inicio, fim } = limitesMesBrasilia(ano, mesNumero);

  const nomeMes = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(ano, mesNumero - 1, 1)));

  const dre = await buscarDRE(usuario.graficaId, inicio, fim);

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/financeiro"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/financeiro"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar ao Financeiro
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            DRE simplificado
          </h1>
          <p className="mt-1 text-slate-500">
            Demonstrativo de resultado de {nomeMes}. Cada linha mostra o
            regime em que foi apurada — <strong>competência</strong> (o que
            foi vendido/lançado, mesmo sem o dinheiro ter entrado/saído
            ainda) ou <strong>caixa</strong> (o que de fato entrou/saiu).
            Linhas <strong>mistas</strong> combinam as duas coisas de
            propósito, nunca em silêncio.
          </p>
        </div>

        <Card className="mb-8 flex flex-col gap-4 p-6 sm:flex-row sm:items-end sm:justify-between">
          <form action="/financeiro/dre" className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">Período</span>
              <input
                type="month"
                name="mes"
                defaultValue={mes}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-500 focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </label>
            <Button type="submit" variant="outline">
              Ver período
            </Button>
          </form>
        </Card>

        <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatTile
            label="Margem de contribuição"
            value={formatoPercent(dre.margemContribuicaoPercent)}
            caption={`${formatoMoeda.format(dre.margemContribuicao)} (competência)`}
            tone={dre.margemContribuicao >= 0 ? "positive" : "neutral"}
          />
          <StatTile
            label="Resultado líquido"
            value={formatoMoeda.format(dre.resultadoLiquido)}
            caption="Margem de contribuição (competência) menos custo fixo/comissão pagos (caixa)"
            tone={dre.resultadoLiquido >= 0 ? "positive" : "neutral"}
          />
          <StatTile
            label="Ponto de equilíbrio"
            value={dre.pontoEquilibrio !== null ? formatoMoeda.format(dre.pontoEquilibrio) : "—"}
            caption={
              dre.pontoEquilibrio !== null
                ? "Receita bruta necessária pra empatar, nesta margem"
                : "Margem de contribuição não-positiva — nenhum volume de venda fecha a conta"
            }
          />
        </div>

        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500 dark:border-slate-700">
                <th className="px-5 py-3 font-medium">Linha</th>
                <th className="px-5 py-3 font-medium">Regime</th>
                <th className="px-5 py-3 text-right font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {dre.linhas.map((linha) => {
                const ehSubtotal = linha.rotulo.startsWith("=");
                return (
                  <tr
                    key={linha.rotulo}
                    className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                      ehSubtotal ? "bg-slate-50 dark:bg-slate-800/40" : ""
                    }`}
                  >
                    <td
                      className={`px-5 py-3 ${
                        ehSubtotal
                          ? "font-semibold text-slate-900 dark:text-white"
                          : "text-slate-700 dark:text-slate-300"
                      }`}
                      title={linha.detalheRegime}
                    >
                      {linha.rotulo}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${COR_REGIME[linha.regime]}`}
                        title={linha.detalheRegime}
                      >
                        {ROTULO_REGIME[linha.regime]}
                      </span>
                    </td>
                    <td
                      className={`px-5 py-3 text-right tabular-nums ${
                        ehSubtotal ? "font-semibold text-slate-900 dark:text-white" : "text-slate-700 dark:text-slate-300"
                      } ${linha.valor < 0 ? "text-rose-600 dark:text-rose-400" : ""}`}
                    >
                      {formatoMoeda.format(linha.valor)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <p className="mt-4 text-xs text-slate-500">
          Impostos são ESTIMATIVA (% configurado em Configurações × receita
          bruta do período), não apuração real de guia paga. Despesas
          financeiras (juros, taxa de maquininha) ainda não têm fonte de
          dado no sistema — aparecem sempre em R$ 0,00 até essa origem ser
          construída.
        </p>
      </main>
    </div>
  );
}
