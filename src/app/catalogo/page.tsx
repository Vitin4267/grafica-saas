import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { podeVerMeuNegocio } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { CatalogoForm } from "./CatalogoForm";

export default async function CatalogoPage() {
  const usuario = await exigirUsuarioAutenticado();

  const [itensCatalogo, itensGrafica] = await Promise.all([
    prisma.itemCatalogo.findMany({
      // Mestre global (graficaId=null) + itens privados criados por essa gráfica.
      where: { OR: [{ graficaId: null }, { graficaId: usuario.graficaId }] },
      orderBy: [{ tipo: "asc" }, { categoria: "asc" }, { nome: "asc" }],
    }),
    prisma.itemGrafica.findMany({
      where: { graficaId: usuario.graficaId },
    }),
  ]);

  const selecoesPorItem = Object.fromEntries(
    itensGrafica.map((ig) => [
      ig.itemCatalogoId,
      {
        id: ig.id,
        ativo: ig.ativo,
        precoCompra: ig.precoCompra?.toString() ?? "",
        precoVenda: ig.precoVenda?.toString() ?? "",
        estoqueAtual: ig.estoqueAtual?.toString() ?? "",
        estoqueMinimo: ig.estoqueMinimo?.toString() ?? "",
      },
    ])
  );

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/catalogo"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Catálogo da gráfica
          </h1>
          <p className="mt-1 text-slate-500">
            Marque tudo o que a sua gráfica faz e usa, e defina os preços de
            compra e venda. Só o que estiver marcado aqui aparece na
            calculadora de orçamento.
          </p>
        </div>

        <CatalogoForm
          itensCatalogo={itensCatalogo.map((i) => ({
            id: i.id,
            tipo: i.tipo,
            categoria: i.categoria,
            nome: i.nome,
            unidade: i.unidade,
          }))}
          selecoes={selecoesPorItem}
        />
      </main>
    </div>
  );
}
