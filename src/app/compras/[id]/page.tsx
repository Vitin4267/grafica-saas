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
import { TRANSICOES_VALIDAS, ROTULOS_STATUS_SOLICITACAO_COMPRA } from "@/lib/compras-status";
import { AcoesSolicitacaoForm } from "./AcoesSolicitacaoForm";

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

  const [solicitacao, fornecedores, movimentacaoGerada] = await Promise.all([
    prisma.solicitacaoCompra.findFirst({
      where: { id, graficaId: usuario.graficaId },
      include: {
        itemGrafica: { include: { itemCatalogo: true } },
        variante: true,
        fornecedor: true,
        usuarioSolicitante: { select: { nome: true } },
        usuarioAprovador: { select: { nome: true } },
      },
    }),
    prisma.fornecedor.findMany({
      where: { graficaId: usuario.graficaId, ativo: true },
      orderBy: { nome: "asc" },
      select: { id: true, nome: true },
    }),
    prisma.movimentacaoEstoque.findFirst({
      where: { solicitacaoCompraId: id },
      select: { quantidade: true, custoUnitario: true, custoTotal: true, createdAt: true },
    }),
  ]);

  if (!solicitacao) {
    notFound();
  }

  const nomeItem = `${solicitacao.itemGrafica.itemCatalogo.nome}${solicitacao.variante ? ` (${solicitacao.variante.rotulo})` : ""}`;
  const unidade = rotuloUnidade(solicitacao.itemGrafica.itemCatalogo.unidade, solicitacao.itemGrafica.itemCatalogo.unidadeOutro);

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
            <div>
              <p className="text-xs font-medium text-slate-500">Fornecedor</p>
              <p className="mt-0.5 text-slate-900 dark:text-white">{solicitacao.fornecedor?.nome ?? "Ainda não definido"}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500">Nº da nota</p>
              <p className="mt-0.5 text-slate-900 dark:text-white">{solicitacao.documento ?? "—"}</p>
            </div>
            {solicitacao.observacao && (
              <div className="col-span-2">
                <p className="text-xs font-medium text-slate-500">Observação</p>
                <p className="mt-0.5 whitespace-pre-wrap text-slate-900 dark:text-white">{solicitacao.observacao}</p>
              </div>
            )}
          </Card>

          {movimentacaoGerada && (
            <Card className="p-6 text-sm">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Entrada de estoque gerada
              </p>
              <p className="text-slate-900 dark:text-white">
                +{formatoQuantidade.format(Number(movimentacaoGerada.quantidade))} {unidade} em{" "}
                {formatoInstanteRealComHora.format(movimentacaoGerada.createdAt)}
                {movimentacaoGerada.custoTotal &&
                  ` · custo total ${formatoMoeda.format(Number(movimentacaoGerada.custoTotal))}`}
              </p>
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

          {podeEditar && (proximosStatus.length > 0 || podeCancelar) && (
            <AcoesSolicitacaoForm
              solicitacaoId={solicitacao.id}
              proximosStatus={proximosStatus}
              podeCancelar={podeCancelar}
              fornecedorAtualId={solicitacao.fornecedorId}
              valorEstimado={solicitacao.valorEstimado ? Number(solicitacao.valorEstimado) : null}
              documentoAtual={solicitacao.documento}
              fornecedores={fornecedores}
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
