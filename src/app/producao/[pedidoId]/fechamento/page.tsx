import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerModulo,
  podeEditarModulo,
  podeVerMeuNegocio,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { calcularPrevisaoAprovacaoPedido } from "@/lib/pedido-aprovacao";
import { lucroDoPedido } from "@/lib/custo-pedido";
import { formatoMoeda } from "@/lib/moeda";
import { formatoInstanteRealComHora } from "@/lib/data";
import { ROTULOS_STATUS_PEDIDO } from "@/lib/producao-estagios";
import { sugerirMaquinaPedido, apontamentoDivergeDaSugestao, type SelecaoMaquina } from "@/lib/apontamento-etapa";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { MedidorMargem } from "@/components/ui/MedidorMargem";
import { ArrowLeftIcon, InfoIcon, AlertTriangleIcon } from "@/components/icons";
import { CustosPedidoSecao } from "../../CustosPedidoSecao";
import { FecharPedidoBotao, ReabrirPedidoBotao } from "./FecharReabrirAcoes";

// Rótulos de exibição pro canal que confirmou cada etapa (ver
// OrigemConfirmacaoEtapa no schema) — mesmo enum usado em ApontamentoEtapa.
const ROTULO_ORIGEM_CONFIRMACAO: Record<"APP" | "LINK_PUBLICO" | "QR_ETIQUETA", string> = {
  APP: "painel",
  LINK_PUBLICO: "link público",
  QR_ETIQUETA: "QR de chão de fábrica",
};

function SecaoHeader({ titulo, nota }: { titulo: string; nota?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-base font-semibold text-slate-900 dark:text-white">{titulo}</h2>
      {nota && <span className="text-xs text-slate-500">{nota}</span>}
    </div>
  );
}

// "—" nunca 0,00: um valor null aqui significa "não apurado ainda", não
// "apurado como zero" (mesmo princípio de custoUnitario null em
// MovimentacaoEstoque — ver fase-custo-real.md §1.1/PR-2).
function moedaOuTraco(valor: number | null): string {
  return valor === null ? "—" : formatoMoeda.format(valor);
}

function percentualOuTraco(valor: number | null): string {
  return valor === null ? "—" : `${valor.toFixed(1).replace(".", ",")}%`;
}

type LinhaCustoCategoria = {
  categoriaId: string;
  categoriaNome: string;
  ordem: number;
  previsto: number | null; // null = categoria SEM nenhuma linha prevista ("não previsto")
  real: number;
};

// Linha previsto | real | desvio — o achado mais acionável do plano
// (fase-custo-real.md §4.1): categoria com custo real e nenhuma linha
// prevista aparece como "não previsto" em vez de um desvio absurdo
// (real/0 = infinito) ou de sumir da tela.
function LinhaCustoLinha({ linha }: { linha: LinhaCustoCategoria }) {
  const naoPrevisto = linha.previsto === null;
  const desvioPercentual =
    linha.previsto !== null && linha.previsto > 0
      ? ((linha.real - linha.previsto) / linha.previsto) * 100
      : null;

  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 py-2 text-sm">
      <span className="text-slate-700 dark:text-slate-300">{linha.categoriaNome}</span>
      <span className="text-right tabular-nums text-slate-600 dark:text-slate-400">
        {naoPrevisto ? "—" : moedaOuTraco(linha.previsto)}
      </span>
      <span className="text-right tabular-nums text-slate-900 dark:text-white">
        {moedaOuTraco(linha.real)}
      </span>
      <span className="min-w-[92px] text-right">
        {naoPrevisto ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
            <AlertTriangleIcon className="h-3.5 w-3.5" />
            não previsto
          </span>
        ) : desvioPercentual === null ? (
          <span className="text-xs text-slate-400">—</span>
        ) : (
          <span
            className={`text-xs font-medium tabular-nums ${
              desvioPercentual > 0.5
                ? "text-rose-600 dark:text-rose-400"
                : desvioPercentual < -0.5
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-slate-500"
            }`}
          >
            {desvioPercentual >= 0 ? "+" : ""}
            {desvioPercentual.toFixed(1).replace(".", ",")}%
          </span>
        )}
      </span>
    </div>
  );
}

export default async function FechamentoPedidoPage({
  params,
}: {
  params: Promise<{ pedidoId: string }>;
}) {
  const { pedidoId } = await params;

  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  // Gate de acesso: precisa poder VER custos/margem — nunca redireciona pra
  // si mesma (evita loop), volta pra /producao (mesmo padrão de
  // exigirVerModulo, mas com destino próprio porque /comecar seria um passo
  // a mais desnecessário partindo da fila de produção).
  const podeVerCustos = await podeVerModulo(usuario, "CUSTOS");
  if (!podeVerCustos) {
    redirect("/producao");
  }
  const podeEditarCustos = await podeEditarModulo(usuario, "CUSTOS");

  const [pedido, categoriasCustoAtivas, parametrosGrafica] = await Promise.all([
    prisma.pedido.findFirst({
      where: { id: pedidoId, graficaId: usuario.graficaId },
      include: {
        orcamento: {
          include: {
            cliente: { select: { nome: true } },
            itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
          },
        },
        custos: {
          include: { categoriaCusto: { select: { id: true, nome: true, ordem: true } } },
          orderBy: { createdAt: "desc" },
        },
        custosPrevisto: {
          include: { categoriaCusto: { select: { id: true, nome: true, ordem: true } } },
        },
      },
    }),
    prisma.categoriaCusto.findMany({
      where: { graficaId: usuario.graficaId, ativa: true },
      orderBy: { ordem: "asc" },
      select: { id: true, nome: true },
    }),
    prisma.parametrosGrafica.findUnique({
      where: { graficaId: usuario.graficaId },
      select: { margemFaixaBaixa: true, margemFaixaBoa: true },
    }),
  ]);
  if (!pedido) {
    notFound();
  }

  // Achado B1/B2 — histórico de etapa (rastro de quem/quando/em qual
  // máquina), buscado por pedidoId (já garantido pertencer à gráfica do
  // usuário logado pelo findFirst acima). Includes resolvem o NOME de cada
  // máquina direto (evita 5 lookups por linha); operadorId é resolvido à
  // parte (sem FK pro Usuario, ver comentário no schema — pode apontar pra
  // um usuário já removido).
  const apontamentos = await prisma.apontamentoEtapa.findMany({
    where: { pedidoId: pedido.id },
    include: {
      prensa: { select: { nome: true } },
      maquinaFlexografia: { select: { nome: true } },
      equipamento: { select: { nome: true } },
      impressoraDigital: { select: { nome: true } },
      maquinaSetupPorPeca: { select: { nome: true } },
    },
    orderBy: { iniciadoEm: "asc" },
  });
  const operadorIds = [...new Set(apontamentos.map((a) => a.operadorId).filter((id): id is string => id !== null))];
  const operadores = operadorIds.length
    ? await prisma.usuario.findMany({ where: { id: { in: operadorIds } }, select: { id: true, nome: true } })
    : [];
  const nomePorOperadorId = new Map(operadores.map((u) => [u.id, u.nome]));

  // Sugestão calculada a partir dos itens do pedido (mesma fórmula de
  // producao/page.tsx) — usada só pra decidir se cada apontamento DIVERGE
  // (achado B2, item 4 do enunciado: aviso na tela de custos/fechamento).
  const sugestaoMaquinaPedido = sugerirMaquinaPedido(pedido.orcamento.itens);
  const linhasApontamento = apontamentos.map((a) => {
    const nomeMaquina =
      a.prensa?.nome ??
      a.maquinaFlexografia?.nome ??
      a.equipamento?.nome ??
      a.impressoraDigital?.nome ??
      a.maquinaSetupPorPeca?.nome ??
      null;
    const selecao: SelecaoMaquina = {
      prensaId: a.prensaId,
      maquinaFlexografiaId: a.maquinaFlexografiaId,
      equipamentoId: a.equipamentoId,
      impressoraDigitalId: a.impressoraDigitalId,
      maquinaSetupPorPecaId: a.maquinaSetupPorPecaId,
    };
    return {
      id: a.id,
      status: a.status,
      iniciadoEm: a.iniciadoEm,
      finalizadoEm: a.finalizadoEm,
      origemConfirmacao: a.origemConfirmacao,
      nomeMaquina,
      operadorNome: a.operadorId ? (nomePorOperadorId.get(a.operadorId) ?? null) : a.operadorNomeDeclarado,
      diverge: apontamentoDivergeDaSugestao(selecao, sugestaoMaquinaPedido),
    };
  });

  const [previsaoAtual, lucro, fechadoPorUsuario] = await Promise.all([
    // Recalculado NA HORA, não lido de PedidoCustoPrevisto — o que faltava
    // previsão no dia da aprovação pode ter sido corrigido depois (ficha
    // técnica cadastrada na semana seguinte). Ver comentário em
    // src/lib/pedido-aprovacao.ts.
    calcularPrevisaoAprovacaoPedido(pedido.orcamentoId, usuario.graficaId),
    // Lucro/margem REAL reaproveitado de src/lib/custo-pedido.ts — nunca
    // recalculado na mão aqui, pra não duplicar a lógica em dois lugares.
    lucroDoPedido(pedido.id),
    pedido.fechadoPorId
      ? prisma.usuario.findUnique({ where: { id: pedido.fechadoPorId }, select: { nome: true } })
      : Promise.resolve(null),
  ]);

  const margemFaixaBaixa = parametrosGrafica ? Number(parametrosGrafica.margemFaixaBaixa) : 10;
  const margemFaixaBoa = parametrosGrafica ? Number(parametrosGrafica.margemFaixaBoa) : 25;

  // VENDA — preço sugerido só existe a partir do PR-6 (desconto no
  // orçamento), fora de escopo desta tarefa. Até lá, precoSugeridoTotal vem
  // sempre null e a erosão por desconto nunca aparece — comportamento
  // esperado, não um bug.
  const precoSugeridoTotal = pedido.precoSugeridoTotal !== null ? Number(pedido.precoSugeridoTotal) : null;
  const valorNegociadoTotal = pedido.valorNegociadoTotal !== null ? Number(pedido.valorNegociadoTotal) : null;
  const mostraErosao = precoSugeridoTotal !== null && valorNegociadoTotal !== null;
  const erosaoValor = mostraErosao ? precoSugeridoTotal! - valorNegociadoTotal! : null;
  const erosaoPercentual =
    mostraErosao && precoSugeridoTotal! > 0 ? (erosaoValor! / precoSugeridoTotal!) * 100 : null;

  // CUSTO por categoria — união (não interseção) de PedidoCustoPrevisto
  // (previsto, congelado na aprovação) e CustoPedido não-estornado (real).
  const mapaCategorias = new Map<string, LinhaCustoCategoria>();
  for (const linha of pedido.custosPrevisto) {
    const valor = Number(linha.valor);
    const existente = mapaCategorias.get(linha.categoriaCustoId);
    if (existente) {
      existente.previsto = (existente.previsto ?? 0) + valor;
    } else {
      mapaCategorias.set(linha.categoriaCustoId, {
        categoriaId: linha.categoriaCustoId,
        categoriaNome: linha.categoriaCusto.nome,
        ordem: linha.categoriaCusto.ordem,
        previsto: valor,
        real: 0,
      });
    }
  }
  const custosReaisAtivos = pedido.custos.filter((c) => c.estornadoEm === null);
  for (const custo of custosReaisAtivos) {
    const valor = Number(custo.valor);
    const existente = mapaCategorias.get(custo.categoriaCustoId);
    if (existente) {
      existente.real += valor;
    } else {
      mapaCategorias.set(custo.categoriaCustoId, {
        categoriaId: custo.categoriaCustoId,
        categoriaNome: custo.categoriaCusto.nome,
        ordem: custo.categoriaCusto.ordem,
        previsto: null,
        real: valor,
      });
    }
  }
  const linhasCusto = [...mapaCategorias.values()].sort(
    (a, b) => a.ordem - b.ordem || a.categoriaNome.localeCompare(b.categoriaNome, "pt-BR")
  );
  const totalPrevisto = linhasCusto.reduce((acc, l) => acc + (l.previsto ?? 0), 0);
  const totalReal = linhasCusto.reduce((acc, l) => acc + l.real, 0);
  const totalDesvioPercentual = totalPrevisto > 0 ? ((totalReal - totalPrevisto) / totalPrevisto) * 100 : null;
  // Sinal formal de previsão parcial (ver calcularPrevisaoAprovacaoPedido) —
  // mesmo com algumas categorias previstas, o total pode não representar o
  // pedido inteiro se algum item não entrou na previsão.
  const previsaoParcial = pedido.custoPrevistoTotal === null && linhasCusto.some((l) => l.previsto !== null);

  // RESULTADO — margem de contribuição prevista (snapshot da aprovação) x
  // real (reaproveitando lucroDoPedido).
  const custoPrevistoTotalPedido = pedido.custoPrevistoTotal !== null ? Number(pedido.custoPrevistoTotal) : null;
  const margemPrevistaValor =
    custoPrevistoTotalPedido !== null && valorNegociadoTotal !== null
      ? valorNegociadoTotal - custoPrevistoTotalPedido
      : null;
  const margemPrevistaPercentual =
    margemPrevistaValor !== null && valorNegociadoTotal !== null && valorNegociadoTotal > 0
      ? (margemPrevistaValor / valorNegociadoTotal) * 100
      : null;
  // Achado de auditoria pré-lançamento (2026-08-15): lucroDoPedido() soma
  // pedido.custos (que pode vir vazio) e SEMPRE retorna um número — sem esta
  // guarda, um pedido sem nenhum custo lançado ainda mostrava aqui "100% de
  // margem" (lucro = receita cheia), contradizendo a seção "Qualidade do
  // dado" mais abaixo na mesma tela e o card lucroCard logo acima, que já
  // tratam "nenhum custo lançado" como null (sem dado), não como "custo
  // zero de verdade". Mesma guarda de custosReaisAtivos.length usada em
  // lucroCard.
  const margemRealValor = custosReaisAtivos.length > 0 ? (lucro?.lucro ?? null) : null;
  const margemRealPercentual =
    custosReaisAtivos.length > 0 && lucro && lucro.receita > 0 ? (lucro.lucro / lucro.receita) * 100 : null;

  // QUALIDADE DO DADO
  const totalCustoRealTudo = custosReaisAtivos.reduce((acc, c) => acc + Number(c.valor), 0);
  const totalAutomatico = custosReaisAtivos
    .filter((c) => c.origem === "CONSUMO_ESTOQUE")
    .reduce((acc, c) => acc + Number(c.valor), 0);
  const percentualAutomatico = totalCustoRealTudo > 0 ? (totalAutomatico / totalCustoRealTudo) * 100 : null;
  const lancamentosManuais = custosReaisAtivos.filter((c) => c.origem === "MANUAL").length;

  // Cartão de custos (reaproveita CustosPedidoSecao) — mesma fórmula de
  // lucro "card" usada em /producao (null quando nada foi lançado ainda,
  // pra não mostrar "lucro = preço cheio" como se fosse apurado).
  const custoTotalPedidoCard = custosReaisAtivos.reduce((soma, c) => soma + Number(c.valor), 0);
  const lucroCard = custosReaisAtivos.length > 0 ? Number(pedido.orcamento.total) - custoTotalPedidoCard : null;

  const itensResumo = pedido.orcamento.itens.map((i) => i.itemGrafica.itemCatalogo.nome).join(", ");

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/producao"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/producao"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar pra Produção
        </Link>

        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                Fechamento do pedido
              </h1>
              <StatusBadge status={pedido.status} tipo="pedido" />
            </div>
            <p className="text-slate-500">
              {pedido.orcamento.cliente.nome} · {itensResumo}
            </p>
          </div>
          <div className="text-right">
            {pedido.fechadoEm ? (
              <p className="text-xs text-slate-500">
                Fechado em {formatoInstanteRealComHora.format(pedido.fechadoEm)}
                {fechadoPorUsuario && ` por ${fechadoPorUsuario.nome}`}
              </p>
            ) : (
              <p className="text-xs text-slate-500">Ainda não fechado</p>
            )}
          </div>
        </div>

        {pedido.fechadoEm && (
          <Alert variant="info">
            Este pedido está fechado — o resultado abaixo é a foto congelada do fechamento. Reabra pra
            lançar ou corrigir custos.
          </Alert>
        )}

        {/* VENDA */}
        <div className="mt-6">
          <SecaoHeader titulo="Venda" />
          <Card className="p-6">
            <div className="flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Preço sugerido (motor)</span>
                <span className="tabular-nums text-slate-700 dark:text-slate-300">
                  {moedaOuTraco(precoSugeridoTotal)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Preço negociado</span>
                <span className="font-medium tabular-nums text-slate-900 dark:text-white">
                  {moedaOuTraco(valorNegociadoTotal)}
                </span>
              </div>
              {mostraErosao && erosaoValor !== null && erosaoValor > 0 && (
                <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 dark:border-slate-800">
                  <span className="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                    <AlertTriangleIcon className="h-3.5 w-3.5" />
                    Erosão por desconto
                  </span>
                  <span className="font-medium tabular-nums text-rose-600 dark:text-rose-400">
                    −{formatoMoeda.format(erosaoValor)} ({percentualOuTraco(erosaoPercentual)})
                  </span>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* CUSTO */}
        <div className="mt-6">
          <SecaoHeader
            titulo="Custo por categoria"
            nota={previsaoParcial ? "previsão parcial — ver Qualidade do dado" : undefined}
          />
          <Card className="p-6">
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-b border-slate-100 pb-2 text-xs font-medium text-slate-400 dark:border-slate-800">
              <span>Categoria</span>
              <span className="text-right">Previsto</span>
              <span className="text-right">Real</span>
              <span className="text-right">Desvio</span>
            </div>
            {linhasCusto.length === 0 ? (
              <p className="py-4 text-sm text-slate-500">
                Nenhum custo previsto ou lançado neste pedido ainda.
              </p>
            ) : (
              <div className="divide-y divide-slate-50 dark:divide-slate-800/60">
                {linhasCusto.map((linha) => (
                  <LinhaCustoLinha key={linha.categoriaId} linha={linha} />
                ))}
              </div>
            )}
            <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 border-t border-slate-200 pt-2 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:text-white">
              <span>Total</span>
              <span className="text-right tabular-nums">{moedaOuTraco(totalPrevisto)}</span>
              <span className="text-right tabular-nums">{moedaOuTraco(totalReal)}</span>
              <span className="min-w-[92px] text-right text-xs tabular-nums">
                {totalDesvioPercentual === null
                  ? "—"
                  : `${totalDesvioPercentual >= 0 ? "+" : ""}${totalDesvioPercentual.toFixed(1).replace(".", ",")}%`}
              </span>
            </div>
          </Card>
        </div>

        {/* RESULTADO */}
        <div className="mt-6">
          <SecaoHeader titulo="Resultado" />
          <Card className="p-6">
            <div className="grid grid-cols-[1fr_auto_auto] gap-3 text-sm">
              <span className="text-slate-500">Margem de contribuição</span>
              <span className="text-right tabular-nums text-slate-600 dark:text-slate-400">
                {moedaOuTraco(margemPrevistaValor)} previsto
              </span>
              <span className="text-right font-semibold tabular-nums text-slate-900 dark:text-white">
                {moedaOuTraco(margemRealValor)} real
              </span>
            </div>
            <div className="mt-4">
              <MedidorMargem
                margem={margemRealPercentual}
                limiarRuim={margemFaixaBaixa}
                limiarBom={margemFaixaBoa}
              />
              {margemPrevistaPercentual !== null && (
                <p className="mt-2 text-xs text-slate-500">
                  Margem prevista na aprovação: {percentualOuTraco(margemPrevistaPercentual)}
                </p>
              )}
            </div>
            <div className="mt-4 flex items-start gap-1.5 text-xs text-slate-500">
              <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Margem de contribuição, não lucro: não inclui custos fixos (aluguel, salários, energia).
              </span>
            </div>
          </Card>
        </div>

        {/* QUALIDADE DO DADO */}
        <div className="mt-6">
          <SecaoHeader titulo="Qualidade do dado" />
          <Card className="p-6">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {percentualAutomatico === null
                ? "Nenhum custo real lançado neste pedido ainda."
                : `${percentualAutomatico.toFixed(0)}% do custo real veio automático do consumo de estoque.`}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {lancamentosManuais} lançamento{lancamentosManuais === 1 ? "" : "s"} manual
              {lancamentosManuais === 1 ? "" : "is"} · {previsaoAtual.itensSemPrevisao.length} item
              {previsaoAtual.itensSemPrevisao.length === 1 ? "" : "s"} sem previsão de custo
            </p>
            {previsaoAtual.itensSemPrevisao.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 border-t border-slate-100 pt-3 text-xs text-amber-700 dark:border-slate-800 dark:text-amber-400">
                {previsaoAtual.itensSemPrevisao.map((texto, indice) => (
                  <li key={indice} className="flex items-start gap-1.5">
                    <AlertTriangleIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{texto}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Achado B1/B2 — histórico de etapa: quando entrou/saiu de cada
            status, quem confirmou (canal) e em qual máquina rodou. Aviso de
            divergência quando a máquina selecionada difere da que os itens
            do pedido usaram na precificação (ver sugerirMaquinaPedido). */}
        <div className="mt-6">
          <SecaoHeader titulo="Etapas e máquinas" />
          <Card className="p-6">
            {linhasApontamento.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nenhum apontamento de etapa registrado ainda para este pedido.
              </p>
            ) : (
              <div className="flex flex-col divide-y divide-slate-50 dark:divide-slate-800/60">
                {linhasApontamento.map((linha) => (
                  <div key={linha.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-800 dark:text-slate-100">
                        {ROTULOS_STATUS_PEDIDO[linha.status]}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatoInstanteRealComHora.format(linha.iniciadoEm)}
                        {linha.finalizadoEm
                          ? ` até ${formatoInstanteRealComHora.format(linha.finalizadoEm)}`
                          : " · em andamento"}
                        {" · "}
                        {ROTULO_ORIGEM_CONFIRMACAO[linha.origemConfirmacao]}
                        {linha.operadorNome ? ` · ${linha.operadorNome}` : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-slate-700 dark:text-slate-300">
                        {linha.nomeMaquina ?? "Sem máquina informada"}
                      </p>
                      {linha.diverge && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                          <AlertTriangleIcon className="h-3.5 w-3.5" />
                          rodou em máquina diferente da orçada
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Custos reais + ações */}
        <div className="mt-6">
          <SecaoHeader titulo="Lançamentos de custo" />
          <CustosPedidoSecao
            pedidoId={pedido.id}
            categoriasCustoAtivas={categoriasCustoAtivas}
            custos={pedido.custos.map((custo) => ({
              id: custo.id,
              categoriaNome: custo.categoriaCusto.nome,
              valor: Number(custo.valor),
              observacao: custo.observacao,
              createdAt: custo.createdAt.toISOString(),
            }))}
            lucro={lucroCard}
            podeEditarCustos={podeEditarCustos}
            podeVer={podeVerCustos}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {podeEditarCustos && !pedido.fechadoEm && <FecharPedidoBotao pedidoId={pedido.id} />}
          {pedido.fechadoEm && <ReabrirPedidoBotao pedidoId={pedido.id} />}
        </div>
      </main>
    </div>
  );
}
