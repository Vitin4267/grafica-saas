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

  const [materiais, fornecedores, alvoPreSelecionado, comparativoPorChave] = await Promise.all([
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
            }))}
            fornecedores={fornecedores}
            itemGraficaIdInicial={alvoPreSelecionado.itemGraficaId}
            varianteIdInicial={alvoPreSelecionado.varianteId}
            comparativoPorChave={comparativoSerializado}
          />
        )}
      </main>
    </div>
  );
}
