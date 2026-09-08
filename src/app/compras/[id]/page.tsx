import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  podeVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { ArrowLeftIcon } from "@/components/icons";
import { formatoMoeda } from "@/lib/moeda";
import { formatoInstanteRealComHora } from "@/lib/data";
import { rotuloUnidade } from "@/lib/unidade";
import {
  TRANSICOES_VALIDAS,
  ROTULOS_STATUS_SOLICITACAO_COMPRA,
  ROTULOS_ORIGEM_SOLICITACAO_COMPRA,
  ROTULOS_TIPO_COMPRA,
} from "@/lib/compras-status";
import { buscarUltimasCotacoesPorItem } from "@/lib/cotacao-fornecedor-db";
import { calcularCustoAquisicaoTotal } from "@/lib/custo-aquisicao-compra";
import { AcoesSolicitacaoForm } from "./AcoesSolicitacaoForm";
import { CotacoesFornecedorCard } from "./CotacoesFornecedorCard";

const formatoQuantidade = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 4 });

export default async function DetalheSolicitacaoCompraPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);

  const podeVer = await podeVerModulo(usuario, "COMPRAS");
  if (!podeVer) {
    redirect("/comecar");
  }
  const podeEditar = await podeEditarModulo(usuario, "COMPRAS");

  const { id } = await params;

  const [solicitacao, fornecedores, movimentacoesGeradas, cotacoes] = await Promise.all([
    prisma.solicitacaoCompra.findFirst({
      where: { id, graficaId: usuario.graficaId },
      include: {
        itemGrafica: { include: { itemCatalogo: true } },
        variante: true,
        fornecedor: true,
        usuarioSolicitante: { select: { nome: true } },
        usuarioAprovador: { select: { nome: true } },
        pedido: { include: { orcamento: { include: { cliente: { select: { nome: true } } } } } },
      },
    }),
    prisma.fornecedor.findMany({
      where: { graficaId: usuario.graficaId, ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
    // Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
    // pode haver mais de uma agora (recebimento parcial gera uma
    // MovimentacaoEstoque por confirmação) — findMany em vez do findFirst
    // de antes, ordenada pela mais antiga primeiro.
    prisma.movimentacaoEstoque.findMany({
      where: { solicitacaoCompraId: id },
      select: { quantidade: true, custoUnitario: true, custoTotal: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.cotacaoFornecedor.findMany({
      where: { solicitacaoCompraId: id, solicitacaoCompra: { graficaId: usuario.graficaId } },
      include: { fornecedor: { select: { nome: true } }, registradaPor: { select: { nome: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  if (!solicitacao) {
    notFound();
  }

  // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // itemGrafica pode ser null (compra por descricaoLivre, ver enum
  // TipoCompra); nome/unidade caem pra descrição livre/genérico.
  const nomeItem = solicitacao.itemGrafica
    ? `${solicitacao.itemGrafica.itemCatalogo.nome}${solicitacao.variante ? ` (${solicitacao.variante.rotulo})` : ""}`
    : (solicitacao.descricaoLivre ?? "Compra avulsa");
  const unidade = solicitacao.itemGrafica
    ? rotuloUnidade(solicitacao.itemGrafica.itemCatalogo.unidade, solicitacao.itemGrafica.itemCatalogo.unidadeOutro)
    : "";

  // Achado A2 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // custo de aquisição real pra exibição (mesma fórmula usada no servidor
  // ao gerar a MovimentacaoEstoque, ver avancarStatusCompra) — só some da
  // tela quando não há nenhum dos 4 componentes preenchidos E valorFinal
  // também é null (nada a mostrar ainda).
  const temComponenteCustoAquisicao =
    solicitacao.valorFrete !== null ||
    solicitacao.valorIpi !== null ||
    solicitacao.valorIcmsCreditavel !== null ||
    solicitacao.valorDesconto !== null;
  const custoAquisicaoTotal =
    solicitacao.valorFinal !== null
      ? calcularCustoAquisicaoTotal(
          solicitacao.valorFinal,
          solicitacao.valorFrete,
          solicitacao.valorIpi,
          solicitacao.valorIcmsCreditavel,
          solicitacao.valorDesconto
        ).toNumber()
      : null;

  // Cotações mudam de figura conforme o status: enquanto SOLICITADO/COTANDO
  // ainda dá pra registrar/editar/marcar vencedora (ver STATUS_PERMITE_COTACAO
  // em ../actions.ts); a partir de APROVADO a decisão já foi copiada pra
  // solicitação e a lista vira só histórico de leitura (achado A4 da
  // auditoria de abrangência, Parte 3/Compras).
  const statusPermiteCotacao = solicitacao.status === "SOLICITADO" || solicitacao.status === "COTANDO";
  const cotacaoEditavel = podeEditar && statusPermiteCotacao;

  // "Última cotação conhecida" de cada fornecedor pra ESTE item/variante —
  // só vale a pena buscar quando o formulário de nova cotação vai de fato
  // aparecer (evita um round-trip extra ao banco em status posteriores).
  // Achado A1 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
  // sem item de catálogo (compra por descricaoLivre) não há "último preço
  // conhecido" pra buscar.
  const ultimasCotacoesConhecidas =
    cotacaoEditavel && solicitacao.itemGraficaId
      ? await buscarUltimasCotacoesPorItem(usuario.graficaId, solicitacao.itemGraficaId, solicitacao.varianteId)
      : [];
  const ultimasPorFornecedor = Object.fromEntries(
    ultimasCotacoesConhecidas.map((c) => [
      c.fornecedorId,
      {
        precoUnitario: c.precoUnitario,
        condicaoPagamento: c.condicaoPagamento,
        prazoEntregaDias: c.prazoEntregaDias,
        frete: c.frete,
      },
    ])
  );

  const timeline: { rotulo: string; data: Date }[] = [
    { rotulo: "Solicitado", data: solicitacao.solicitadoEm },
    ...(solicitacao.cotandoEm ? [{ rotulo: "Em cotação", data: solicitacao.cotandoEm }] : []),
    ...(solicitacao.aprovadoEm
      ? [{ rotulo: `Aprovado${solicitacao.usuarioAprovador ? ` por ${solicitacao.usuarioAprovador.nome}` : ""}`, data: solicitacao.aprovadoEm }]
      : []),
    ...(solicitacao.compradoEm ? [{ rotulo: "Comprado", data: solicitacao.compradoEm }] : []),
    ...(solicitacao.recebidoEm ? [{ rotulo: "Recebido (estoque atualizado)", data: solicitacao.recebidoEm }] : []),
    ...(solicitacao.conferidoEm ? [{ rotulo: "Conferido", data: solicitacao.conferidoEm }] : []),
    ...(solicitacao.canceladoEm ? [{ rotulo: "Cancelado", data: solicitacao.canceladoEm }] : []),
  ];

  const proximosStatus = TRANSICOES_VALIDAS[solicitacao.status].filter((s) => s !== "CANCELADO");
  const podeCancelar = TRANSICOES_VALIDAS[solicitacao.status].includes("CANCELADO");

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/compras"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <Link
          href="/compras"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar pra Compras
        </Link>

        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{nomeItem}</h1>
            <p className="mt-1 text-slate-500">
              {formatoQuantidade.format(Number(solicitacao.quantidade))} {unidade} · solicitado por{" "}
              {solicitacao.usuarioSolicitante.nome}
            </p>
          </div>
          <StatusBadge status={solicitacao.status} tipo="compra" />
        </div>

        <div className="flex flex-col gap-6">
          <Card className="grid grid-cols-2 gap-4 p-6 text-sm">
            <div>
              <p className="text-xs font-medium text-slate-500">Tipo de compra</p>
              <p className="mt-0.5 text-slate-900 dark:text-white">
                {ROTULOS_TIPO_COMPRA[solicitacao.tipoCompra]}
                {solicitacao.tipoCompra === "OUTRO" && solicitacao.tipoCompraOutro ? ` — ${solicitacao.tipoCompraOutro}` : ""}
              </p>
            </div>
            {solicitacao.descricaoLivre && (
              <div>
                <p className="text-xs font-medium text-slate-500">Descrição</p>
                <p className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-white">{solicitacao.descricaoLivre}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-slate-500">Valor estimado</p>
              <p className="mt-0.5 text-slate-900 dark:text-white">
                {solicitacao.valorEstimado ? formatoMoeda.format(Number(solicitacao.valorEstimado)) : "—"}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Valor final pago</p>
              <p className="mt-0.5 text-slate-900 dark:text-white">
                {solicitacao.valorFinal ? formatoMoeda.format(Number(solicitacao.valorFinal)) : "—"}
              </p>
            </div>
            {/* Achado A2 da auditoria de abrangência (Parte 3/Compras, 2026-09-06) —
                só aparece quando algum dos 4 componentes foi preenchido, pra não
                poluir a tela de toda compra simples (o padrão da maioria). */}
            {temComponenteCustoAquisicao && (
              <>
                <div>
                  <p className="text-xs font-medium text-slate-500">Frete / IPI</p>
                  <p className="mt-0.5 text-slate-900 dark:text-white">
                    {formatoMoeda.format(Number(solicitacao.valorFrete ?? 0))} /{" "}
                    {formatoMoeda.format(Number(solicitacao.valorIpi ?? 0))}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">ICMS creditável / Desconto</p>
                  <p className="mt-0.5 text-slate-900 dark:text-white">
                    {formatoMoeda.format(Number(solicitacao.valorIcmsCreditavel ?? 0))} /{" "}
                    {formatoMoeda.format(Number(solicitacao.valorDesconto ?? 0))}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-500">Custo de aquisição total</p>
                  <p className="mt-0.5 font-medium text-slate-900 dark:text-white">
                    {custoAquisicaoTotal !== null ? formatoMoeda.format(custoAquisicaoTotal) : "—"}
                  </p>
                </div>
              </>
            )}
            <div>
              <p className="text-xs font-medium text-slate-500">Fornecedor</p>
              <p className="mt-0.5 text-slate-900 dark:text-white">{solicitacao.fornecedor?.nome ?? "Ainda não definido"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Nº da nota</p>
              <p className="mt-0.5 text-slate-900 dark:text-white">{solicitacao.documento ?? "—"}</p>
            </div>
            {/* Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
                só aparece depois da primeira confirmação de recebimento. */}
            {solicitacao.quantidadeRecebida !== null && (
              <div>
                <p className="text-xs font-medium text-slate-500">Quantidade recebida</p>
                <p className="mt-0.5 text-slate-900 dark:text-white">
                  {formatoQuantidade.format(Number(solicitacao.quantidadeRecebida))} de{" "}
                  {formatoQuantidade.format(Number(solicitacao.quantidade))} {unidade}
                </p>
              </div>
            )}
            {solicitacao.valorNotaFiscal !== null && (
              <div>
                <p className="text-xs font-medium text-slate-500">Valor da nota fiscal</p>
                <p className="mt-0.5 text-slate-900 dark:text-white">
                  {formatoMoeda.format(Number(solicitacao.valorNotaFiscal))}
                </p>
              </div>
            )}
            {solicitacao.divergenciaObservacao && (
              <div className="col-span-2">
                <p className="text-xs font-medium text-slate-500">Divergência no recebimento</p>
                <p className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-white">
                  {solicitacao.divergenciaObservacao}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-slate-500">Origem</p>
              <p className="mt-0.5 text-slate-900 dark:text-white">
                {ROTULOS_ORIGEM_SOLICITACAO_COMPRA[solicitacao.origem]}
                {solicitacao.origem === "OUTRO" && solicitacao.origemOutro ? ` — ${solicitacao.origemOutro}` : ""}
              </p>
            </div>
            {solicitacao.pedido && (
              <div>
                <p className="text-xs font-medium text-slate-500">Pedido vinculado</p>
                <p className="mt-0.5 text-slate-900 dark:text-white">
                  <Link href={`/producao/${solicitacao.pedido.id}`} className="text-teal-700 underline dark:text-teal-400">
                    {solicitacao.pedido.orcamento.cliente.nome}
                  </Link>
                </p>
              </div>
            )}
            {solicitacao.observacao && (
              <div className="col-span-2">
                <p className="text-xs font-medium text-slate-500">Observação</p>
                <p className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-white">{solicitacao.observacao}</p>
              </div>
            )}
          </Card>

          {movimentacoesGeradas.length > 0 && (
            <Card className="p-6 text-sm">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {/* Achado A7 da auditoria de abrangência (Parte 3/Compras, 2026-09-07) —
                    mais de uma linha quando houve recebimento parcial (uma
                    MovimentacaoEstoque por confirmação). */}
                Entrada{movimentacoesGeradas.length > 1 ? "s" : ""} de estoque gerada
                {movimentacoesGeradas.length > 1 ? "s" : ""}
              </p>
              <ul className="flex flex-col gap-1.5">
                {movimentacoesGeradas.map((mov, i) => (
                  <li key={i} className="text-slate-900 dark:text-white">
                    +{formatoQuantidade.format(Number(mov.quantidade))} {unidade} em{" "}
                    {formatoInstanteRealComHora.format(mov.createdAt)}
                    {mov.custoTotal && ` · custo total ${formatoMoeda.format(Number(mov.custoTotal))}`}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-6">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wide text-slate-500">Linha do tempo</p>
            <ol className="flex flex-col gap-3 text-sm">
              {timeline.map((evento) => (
                <li key={evento.rotulo} className="flex items-baseline justify-between gap-3">
                  <span className="text-slate-900 dark:text-white">{evento.rotulo}</span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {formatoInstanteRealComHora.format(evento.data)}
                  </span>
                </li>
              ))}
            </ol>
          </Card>

          {(cotacoes.length > 0 || cotacaoEditavel) && (
            <CotacoesFornecedorCard
              solicitacaoId={solicitacao.id}
              editavel={cotacaoEditavel}
              fornecedores={fornecedores}
              cotacoes={cotacoes.map((c) => ({
                id: c.id,
                fornecedorId: c.fornecedorId,
                fornecedorNome: c.fornecedor.nome,
                precoUnitario: Number(c.precoUnitario),
                valorTotal: Number(c.valorTotal),
                prazoEntregaDias: c.prazoEntregaDias,
                condicaoPagamento: c.condicaoPagamento,
                validaAte: c.validaAte ? c.validaAte.toISOString() : null,
                frete: c.frete !== null ? Number(c.frete) : null,
                observacao: c.observacao,
                vencedora: c.vencedora,
                registradaPorNome: c.registradaPor.nome,
              }))}
              ultimasPorFornecedor={ultimasPorFornecedor}
              quantidadeSolicitada={Number(solicitacao.quantidade)}
              unidade={unidade}
            />
          )}

          {podeEditar && (proximosStatus.length > 0 || podeCancelar) && (
            <AcoesSolicitacaoForm
              solicitacaoId={solicitacao.id}
              statusAtual={solicitacao.status}
              proximosStatus={proximosStatus}
              podeCancelar={podeCancelar}
              fornecedorAtualId={solicitacao.fornecedorId}
              valorEstimado={solicitacao.valorEstimado ? Number(solicitacao.valorEstimado) : null}
              documentoAtual={solicitacao.documento}
              fornecedores={fornecedores}
              geraMovimentacaoEstoque={solicitacao.tipoCompra === "MATERIA_PRIMA" && solicitacao.itemGraficaId !== null}
              quantidadeSolicitada={Number(solicitacao.quantidade)}
              quantidadeJaRecebida={solicitacao.quantidadeRecebida ? Number(solicitacao.quantidadeRecebida) : null}
              unidade={unidade}
            />
          )}

          {!podeEditar && proximosStatus.length === 0 && !podeCancelar && (
            <p className="text-xs text-slate-500">
              {ROTULOS_STATUS_SOLICITACAO_COMPRA[solicitacao.status]} é um status final — nenhuma ação disponível.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
