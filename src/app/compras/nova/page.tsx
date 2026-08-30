import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerMeuNegocio, exigirEditarModulo, obterModulosVisiveis } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { ArrowLeftIcon } from "@/components/icons";
import { rotuloUnidade } from "@/lib/unidade";
import { buscarComparativoFornecedores } from "@/lib/comparativo-fornecedores-db";
import type { ContratoAtivoResumo } from "@/lib/contrato-fornecimento";
import { NovaSolicitacaoForm } from "./NovaSolicitacaoForm";

// alvoId vem do link "Solicitar compra" da sugestão de estoque baixo em
// /compras (ver page.tsx) — lá o id da previsão é itemGraficaId OU
// varianteId (mesma ambiguidade de calcularPrevisaoEstoque), então tenta os
// dois aqui, sempre revalidando contra a gráfica do usuário antes de
// pré-selecionar qualquer coisa no formulário.
async function resolverAlvoPreSelecionado(alvoId: string | undefined, graficaId: string) {
  if (!alvoId) return { itemGraficaId: "", varianteId: "" };

  const comoItem = await prisma.itemGrafica.findFirst({
    where: { id: alvoId, graficaId, itemCatalogo: { tipo: "MATERIA_PRIMA" }, ativo: true },
    select: { id: true },
  });
  if (comoItem) {
    return { itemGraficaId: comoItem.id, varianteId: "" };
  }

  const comoVariante = await prisma.varianteMateriaPrima.findFirst({
    where: { id: alvoId, ativo: true, itemGrafica: { graficaId, ativo: true } },
    select: { id: true, itemGraficaId: true },
  });
  if (comoVariante) {
    return { itemGraficaId: comoVariante.itemGraficaId, varianteId: comoVariante.id };
  }

  return { itemGraficaId: "", varianteId: "" };
}

export default async function NovaSolicitacaoCompraPage({
  searchParams,
}: {
  searchParams: Promise<{ alvoId?: string }>;
}) {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await exigirEditarModulo(usuario, "COMPRAS"))) {
    redirect("/compras");
  }

  const { alvoId } = await searchParams;
  const agora = new Date();

  const [materiais, fornecedores, alvoPreSelecionado, comparativoPorChave, pedidos, contratosAtivos] =
    await Promise.all([
      prisma.itemGrafica.findMany({
        where: { graficaId: usuario.graficaId, ativo: true, itemCatalogo: { tipo: "MATERIA_PRIMA" } },
        include: { itemCatalogo: true, variantes: { where: { ativo: true }, orderBy: { rotulo: "asc" } } },
        orderBy: { itemCatalogo: { nome: "asc" } },
      }),
      prisma.fornecedor.findMany({
        where: { graficaId: usuario.graficaId, ativo: true },
        orderBy: { nome: "asc" },
        select: { id: true, nome: true },
      }),
      resolverAlvoPreSelecionado(alvoId, usuario.graficaId),
      buscarComparativoFornecedores(usuario.graficaId),
      // Pedidos elegíveis pra origem=PEDIDO_ESPECIFICO (achado A3 da auditoria
      // de abrangência, Parte 3/Compras) — CANCELADO fica de fora, não faz
      // sentido comprar material especificamente pra um pedido cancelado.
      prisma.pedido.findMany({
        where: { graficaId: usuario.graficaId, status: { not: "CANCELADO" } },
        include: { orcamento: { include: { cliente: { select: { nome: true } } } } },
        orderBy: { createdAt: "desc" },
        take: 200,
      }),
      // Contratos de fornecimento ATIVOS e dentro da vigência (achado A9 da
      // auditoria de abrangência, Parte 3/Compras) — o formulário mostra
      // "Contrato ativo: R$X/unidade até DD/MM" quando a matéria-prima/
      // variante escolhida bate com um destes (ver contratosAplicaveis).
      prisma.contratoFornecimento.findMany({
        where: {
          graficaId: usuario.graficaId,
          ativo: true,
          vigenciaInicio: { lte: agora },
          vigenciaFim: { gte: agora },
        },
        include: { fornecedor: { select: { nome: true } } },
      }),
    ]);

  // Serializa o Map pra objeto simples (chave = itemGraficaId ou varianteId,
  // ver chaveComparativo) e as datas pra ISO — o client component só
  // reformata pra exibição, nunca recalcula nada daqui.
  const comparativoSerializado = Object.fromEntries(
    Array.from(comparativoPorChave.entries()).map(([chave, linhas]) => [
      chave,
      linhas.map((linha) => ({
        ...linha,
        ultimaCompraEm: linha.ultimaCompraEm.toISOString(),
        historico: linha.historico.map((h) => ({ preco: h.preco, data: h.data.toISOString() })),
      })),
    ])
  );

  const contratosAtivosSerializados: ContratoAtivoResumo[] = contratosAtivos.map((c) => ({
    id: c.id,
    fornecedorId: c.fornecedorId,
    fornecedorNome: c.fornecedor.nome,
    itemGraficaId: c.itemGraficaId,
    varianteId: c.varianteId,
    precoUnitario: Number(c.precoUnitario),
    unidadeCompra: c.unidadeCompra,
    unidadeCompraOutro: c.unidadeCompraOutro,
    vigenciaFim: c.vigenciaFim.toISOString(),
  }));

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

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Nova solicitação de compra</h1>
          <p className="mt-1 text-slate-500">
            Nasce em &quot;Solicitado&quot; — cotação, aprovação e fornecedor podem ser definidos depois.
          </p>
        </div>

        {materiais.length === 0 ? (
          <p className="text-sm text-slate-500">
            Nenhuma matéria-prima cadastrada ainda.{" "}
            <Link href="/catalogo" className="font-medium text-teal-700 underline dark:text-teal-400">
              Cadastre no Catálogo
            </Link>{" "}
            antes de solicitar uma compra.
          </p>
        ) : (
          <NovaSolicitacaoForm
            materiais={materiais.map((m) => ({
              id: m.id,
              nome: m.itemCatalogo.nome,
              unidade: rotuloUnidade(m.itemCatalogo.unidade, m.itemCatalogo.unidadeOutro),
              variantes: m.variantes.map((v) => ({ id: v.id, rotulo: v.rotulo })),
              // Achado A6 da auditoria de abrangência (Parte 3/Compras) —
              // pré-preenchimento da unidade/fator de compra padrão, ver
              // NovaSolicitacaoForm.
              unidadeCompraPadrao: m.unidadeCompraPadrao ?? "",
              unidadeCompraPadraoOutro: m.unidadeCompraPadraoOutro ?? "",
              fatorConversaoCompraPadrao: m.fatorConversaoCompraPadrao?.toString() ?? "",
              loteMinimoCompra: m.loteMinimoCompra?.toString() ?? "",
              multiploCompra: m.multiploCompra?.toString() ?? "",
            }))}
            fornecedores={fornecedores}
            itemGraficaIdInicial={alvoPreSelecionado.itemGraficaId}
            varianteIdInicial={alvoPreSelecionado.varianteId}
            comparativoPorChave={comparativoSerializado}
            pedidos={pedidos.map((p) => ({ id: p.id, clienteNome: p.orcamento.cliente.nome }))}
            contratosAtivos={contratosAtivosSerializados}
          />
        )}
      </main>
    </div>
  );
}
