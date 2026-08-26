import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, obterModulosVisiveis } from "@/lib/auth/permissoes";
import {
  buscarRelatorioNegocio,
  buscarRankingGeral,
  buscarReceitaCustoLucroMensal,
  buscarReceitaPorClienteEMes,
} from "@/lib/relatorios-negocio";
import { formatoMoeda } from "@/lib/moeda";
import {
  limitesDiaBrasilia,
  inicioMesAtualBrasilia,
  hojeBrasiliaInputValue,
  dataParaInputValue,
} from "@/lib/data";
import { D } from "@/lib/pricing/decimal";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { StatTile } from "@/components/ui/StatTile";
import { RankingBars, CORES_CATEGORICAS, COR_OUTROS } from "@/components/ui/RankingBars";
import { MedidorMargem } from "@/components/ui/MedidorMargem";
import {
  ArrowLeftIcon,
  TrendingUpIcon,
  ReceiptIcon,
  UsersIcon,
  BoxIcon,
  SparklesIcon,
} from "@/components/icons";

const REGEX_DATA = /^\d{4}-\d{2}-\d{2}$/;

function SecaoHeader({ titulo, nota }: { titulo: string; nota?: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{titulo}</h2>
      {nota && <span className="text-xs text-slate-500">{nota}</span>}
    </div>
  );
}

export default async function RelatoriosNegocioPage({
  searchParams,
}: {
  searchParams: Promise<{ de?: string; ate?: string; clienteId?: string }>;
}) {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!podeVerMeuNegocio(usuario)) {
    redirect("/orcamento");
  }

  const { de, ate, clienteId } = await searchParams;
  const filtrosAtivos = Boolean(de || ate || clienteId);

  // Sem filtro de data: mês atual (calendário de Brasília), mesmo padrão de
  // "faturamento do mês" já usado em /meu-negocio (buscarVisaoGeralNegocio).
  const deInput = de && REGEX_DATA.test(de) ? de : dataParaInputValue(inicioMesAtualBrasilia());
  const ateInput = ate && REGEX_DATA.test(ate) ? ate : hojeBrasiliaInputValue();
  const inicio = limitesDiaBrasilia(deInput).inicio;
  const fim = limitesDiaBrasilia(ateInput).fim;
  const clienteIdFiltro = clienteId || undefined;

  const [relatorio, ranking, receitaMensal, receitaClienteMes, clientes, parametrosGrafica] = await Promise.all([
    buscarRelatorioNegocio({ graficaId: usuario.graficaId, inicio, fim, clienteId: clienteIdFiltro }),
    buscarRankingGeral(usuario.graficaId),
    // Duas seções "planilha dinâmica" abaixo — sempre últimos 12 meses fixos,
    // igual ranking geral: não leem de/até/clienteId da tela.
    buscarReceitaCustoLucroMensal(usuario.graficaId),
    buscarReceitaPorClienteEMes(usuario.graficaId),
    prisma.cliente.findMany({
      // desativadoEm: null — mesmo filtro dos outros dropdowns de cliente
      // (ver achado A9/A13). Relatório histórico (receita por cliente/mês)
      // continua enxergando clientes desativados via clienteId gravado no
      // Orcamento — só o filtro deste <select> muda.
      where: { graficaId: usuario.graficaId, desativadoEm: null },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    }),
    // Faixas do medidor de margem (fase "custo real" §1.5/PR-5) — configuráveis
    // por gráfica, com o mesmo default 10/25 do componente se a gráfica nunca
    // abriu Configurações (sem linha em ParametrosGrafica ainda).
    prisma.parametrosGrafica.findUnique({
      where: { graficaId: usuario.graficaId },
      select: { margemFaixaBaixa: true, margemFaixaBoa: true },
    }),
  ]);
  const margemFaixaBaixa = parametrosGrafica ? Number(parametrosGrafica.margemFaixaBaixa) : 10;
  const margemFaixaBoa = parametrosGrafica ? Number(parametrosGrafica.margemFaixaBoa) : 25;

  const queryString = new URLSearchParams({
    de: deInput,
    ate: ateInput,
    ...(clienteIdFiltro ? { clienteId: clienteIdFiltro } : {}),
  }).toString();

  const { metricas } = relatorio;

  // "Outros" agrupa categorias além das primeiras CORES_CATEGORICAS.length —
  // a paleta não gera uma cor nova pra cada categoria que a gráfica cadastrar
  // (ver comentário em RankingBars.tsx). Soma em D, não Number() += , mesma
  // disciplina do resto do financeiro.
  const categoriasVisiveis =
    relatorio.custosPorCategoria.length <= CORES_CATEGORICAS.length
      ? relatorio.custosPorCategoria.map((c, indice) => ({
          chave: c.categoriaId,
          rotulo: c.categoriaNome,
          valor: c.total,
          valorFormatado: formatoMoeda.format(c.total),
          corClasse: CORES_CATEGORICAS[indice],
        }))
      : [
          ...relatorio.custosPorCategoria.slice(0, CORES_CATEGORICAS.length - 1).map((c, indice) => ({
            chave: c.categoriaId,
            rotulo: c.categoriaNome,
            valor: c.total,
            valorFormatado: formatoMoeda.format(c.total),
            corClasse: CORES_CATEGORICAS[indice],
          })),
          (() => {
            const restante = relatorio.custosPorCategoria.slice(CORES_CATEGORICAS.length - 1);
            const total = restante
              .reduce((acc, c) => acc.plus(c.total), new D(0))
              .toNumber();
            return {
              chave: "outros",
              rotulo: `Outros (${restante.length})`,
              valor: total,
              valorFormatado: formatoMoeda.format(total),
              corClasse: COR_OUTROS,
            };
          })(),
        ];

  const itensTopClientes = relatorio.topClientes.map((c) => ({
    chave: c.id,
    rotulo: c.nome,
    valor: c.total,
    valorFormatado: formatoMoeda.format(c.total),
  }));

  const itensProdutos = relatorio.produtosMaisVendidos.map((p, indice) => ({
    chave: `${p.nome}-${indice}`,
    rotulo: p.nome,
    valor: p.quantidade,
    valorFormatado: `${p.quantidade} un · ${formatoMoeda.format(p.total)}`,
  }));

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/meu-negocio"
        mostrarMeuNegocio
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <Link
          href="/meu-negocio"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar pra Meu Negócio
        </Link>

        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              Relatórios completos
            </h1>
            <p className="mt-1 text-slate-500">
              Faturado, custos, lucro e margem — filtre por período e cliente.
            </p>
          </div>
          <a
            href={`/meu-negocio/relatorios/exportar?${queryString}`}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            Exportar CSV do período
          </a>
        </div>

        {/* Filtros */}
        <Card className="mb-8 p-6">
          <form className="flex flex-wrap items-end gap-3">
            <div className="w-40">
              <Input label="De" type="date" name="de" defaultValue={deInput} />
            </div>
            <div className="w-40">
              <Input label="Até" type="date" name="ate" defaultValue={ateInput} />
            </div>
            <div className="min-w-[220px] flex-1">
              <Select label="Cliente" name="clienteId" defaultValue={clienteIdFiltro ?? ""}>
                <option value="">Todos os clientes</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="submit" variant="outline">
              Filtrar
            </Button>
            {filtrosAtivos && (
              <Link
                href="/meu-negocio/relatorios"
                className="text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              >
                Limpar filtros
              </Link>
            )}
          </form>
          {!filtrosAtivos && (
            <p className="mt-3 text-xs text-slate-500">
              Mostrando o mês atual por padrão. Ajuste as datas acima pra ver outro período.
            </p>
          )}
        </Card>

        {/* Métricas do período */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatTile
            label="Faturado"
            value={formatoMoeda.format(metricas.faturado)}
            icon={<TrendingUpIcon className="h-4 w-4" />}
            tone="positive"
          />
          <StatTile
            label="Pedidos"
            value={String(metricas.pedidos)}
            icon={<ReceiptIcon className="h-4 w-4" />}
          />
          <StatTile
            label="Ticket médio"
            value={metricas.ticketMedio !== null ? formatoMoeda.format(metricas.ticketMedio) : "—"}
            icon={<ReceiptIcon className="h-4 w-4" />}
          />
          <StatTile
            label="Custos"
            value={formatoMoeda.format(metricas.custos)}
            caption="Lançados por pedido na produção"
            icon={<BoxIcon className="h-4 w-4" />}
          />
          <StatTile
            label="Lucro"
            value={formatoMoeda.format(metricas.lucro)}
            tone={metricas.lucro >= 0 ? "positive" : "neutral"}
            icon={<TrendingUpIcon className="h-4 w-4" />}
          />
        </div>

        {/* Margem */}
        <div className="mt-6">
          <SecaoHeader titulo="Margem de faturamento" nota="Lucro ÷ Faturado, no período filtrado" />
          <Card className="p-6">
            <MedidorMargem margem={metricas.margem} limiarRuim={margemFaixaBaixa} limiarBom={margemFaixaBoa} />

            {metricas.impostoEstimado !== null && metricas.lucroLiquidoEstimado !== null && (
              <div className="mt-4 flex flex-col gap-1 border-t border-slate-100 pt-4 text-sm dark:border-slate-800">
                <div className="flex items-center justify-between text-slate-500">
                  <span>
                    Imposto estimado (
                    {metricas.impostoEstimadoPercent!.toFixed(1).replace(".", ",")}% do faturado)
                  </span>
                  <span className="tabular-nums">−{formatoMoeda.format(metricas.impostoEstimado)}</span>
                </div>
                <div className="flex items-center justify-between font-medium text-slate-800 dark:text-slate-100">
                  <span>Lucro líquido estimado</span>
                  <span className="tabular-nums">{formatoMoeda.format(metricas.lucroLiquidoEstimado)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Estimativa a partir da alíquota configurada em Configurações — não é imposto
                  efetivamente pago/rastreado, e ainda não desconta custo fixo (aluguel, salários
                  etc.).
                </p>
              </div>
            )}
          </Card>
        </div>

        {/* Top clientes + custos por categoria */}
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <SecaoHeader titulo="Top 5 clientes no período" />
            <Card className="p-6">
              <RankingBars
                itens={itensTopClientes}
                vazio="Nenhum orçamento aprovado nesse período."
              />
            </Card>
          </div>
          <div>
            <SecaoHeader titulo="Custos por categoria" nota="Lançamentos no período" />
            <Card className="p-6">
              <RankingBars
                itens={categoriasVisiveis}
                vazio="Nenhum custo lançado nesse período."
              />
            </Card>
          </div>
        </div>

        {/* Produtos mais vendidos */}
        <div className="mt-6">
          <SecaoHeader titulo="Produtos mais vendidos" nota="Por quantidade, no período" />
          <Card className="p-6">
            <RankingBars itens={itensProdutos} vazio="Nenhum item vendido nesse período." />
          </Card>
        </div>

        {/* Ranking geral — independente do filtro acima */}
        <div className="mt-10">
          <div className="mb-4 flex items-center gap-2">
            <SparklesIcon className="h-4 w-4 text-teal-600 dark:text-teal-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Ranking geral
            </h2>
            <span className="text-xs text-slate-500">
              ({ranking.janelaRankingRotulo}, não muda com o filtro acima)
            </span>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <StatTile
              label="Cliente que mais comprou"
              value={ranking.clienteQueMaisComprou?.nome ?? "—"}
              caption={
                ranking.clienteQueMaisComprou
                  ? formatoMoeda.format(ranking.clienteQueMaisComprou.total)
                  : "Nenhum orçamento aprovado ainda"
              }
              icon={<UsersIcon className="h-4 w-4" />}
            />
            <StatTile
              label="Mês que mais faturou"
              value={ranking.mesQueMaisFaturou?.rotulo ?? "—"}
              caption={
                ranking.mesQueMaisFaturou
                  ? formatoMoeda.format(ranking.mesQueMaisFaturou.total)
                  : "Sem dados suficientes"
              }
              icon={<TrendingUpIcon className="h-4 w-4" />}
            />
            <StatTile
              label="Este mês vs. mês anterior"
              value={
                ranking.variacaoPercentual !== null
                  ? `${ranking.variacaoPercentual >= 0 ? "+" : ""}${ranking.variacaoPercentual
                      .toFixed(1)
                      .replace(".", ",")}%`
                  : "—"
              }
              tone={
                ranking.variacaoPercentual !== null && ranking.variacaoPercentual >= 0
                  ? "positive"
                  : "neutral"
              }
              caption={`${formatoMoeda.format(ranking.faturamentoMesAtual)} vs. ${formatoMoeda.format(
                ranking.faturamentoMesAnterior
              )} no mês anterior`}
              icon={<TrendingUpIcon className="h-4 w-4" />}
            />
          </div>
        </div>

        {/* Faturamento mês a mês — independente do filtro acima, mesma janela
            fixa de 12 meses do Ranking geral */}
        <div className="mt-10">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Faturamento mês a mês
            </h2>
            <span className="text-xs text-slate-500">
              (últimos {receitaMensal.length} meses, não muda com o filtro acima)
            </span>
          </div>
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-sm tabular-nums">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50">
                <tr>
                  <th className="px-4 py-2">Mês</th>
                  <th className="px-4 py-2 text-right">Receita</th>
                  <th className="px-4 py-2 text-right">Custos</th>
                  <th className="px-4 py-2 text-right">Lucro</th>
                  <th className="px-4 py-2 text-right">Margem</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {receitaMensal.map((m) => (
                  <tr
                    key={`${m.ano}-${m.mes}`}
                    className={m.lucro < 0 ? "bg-rose-50/60 dark:bg-rose-950/20" : undefined}
                  >
                    <td className="px-4 py-2 font-medium text-slate-900 dark:text-white">{m.rotulo}</td>
                    <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">
                      {formatoMoeda.format(m.faturado)}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-600 dark:text-slate-300">
                      {formatoMoeda.format(m.custos)}
                    </td>
                    <td
                      className={`px-4 py-2 text-right font-semibold ${
                        m.lucro >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-rose-600 dark:text-rose-400"
                      }`}
                    >
                      {formatoMoeda.format(m.lucro)}
                    </td>
                    <td className="px-4 py-2 text-right text-slate-500">
                      {m.margemPercent !== null ? `${m.margemPercent.toFixed(1).replace(".", ",")}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>

        {/* Faturamento por cliente × mês — mesma janela fixa de 12 meses,
            top clientes por faturamento total na janela */}
        <div className="mt-10">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Faturamento por cliente × mês
            </h2>
            <span className="text-xs text-slate-500">
              (top {receitaClienteMes.clientes.length} clientes, últimos {receitaClienteMes.meses.length} meses,
              não muda com o filtro acima)
            </span>
          </div>
          <Card className="overflow-x-auto p-0">
            {receitaClienteMes.clientes.length === 0 ? (
              <p className="p-6 text-sm text-slate-500">
                Nenhum cliente com faturamento nos últimos {receitaClienteMes.meses.length} meses.
              </p>
            ) : (
              <table className="w-full text-sm tabular-nums">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/50">
                  <tr>
                    <th className="sticky left-0 z-10 whitespace-nowrap bg-slate-50 px-4 py-2 dark:bg-slate-800/50">
                      Cliente
                    </th>
                    {receitaClienteMes.meses.map((m) => (
                      <th key={`${m.ano}-${m.mes}`} className="whitespace-nowrap px-3 py-2 text-right">
                        {m.rotulo}
                      </th>
                    ))}
                    <th className="whitespace-nowrap px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {receitaClienteMes.clientes.map((c) => (
                    <tr key={c.clienteId}>
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-2 font-medium text-slate-900 dark:bg-slate-900 dark:text-white">
                        {c.clienteNome}
                      </td>
                      {receitaClienteMes.meses.map((m) => {
                        const chave = `${m.ano}-${String(m.mes).padStart(2, "0")}`;
                        const valor = c.porMes[chave] ?? 0;
                        return (
                          <td
                            key={chave}
                            className="whitespace-nowrap px-3 py-2 text-right text-slate-600 dark:text-slate-300"
                          >
                            {valor > 0 ? formatoMoeda.format(valor) : "—"}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap px-4 py-2 text-right font-semibold text-slate-900 dark:text-white">
                        {formatoMoeda.format(c.total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
