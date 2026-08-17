import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  exigirVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { AlertTriangleIcon } from "@/components/icons";
import { verificarEDispararAlertaEstoque } from "@/lib/alerta-estoque";
import { CatalogoForm } from "./CatalogoForm";

export default async function CatalogoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "CATALOGO");
  const podeEditar = await podeEditarModulo(usuario, "CATALOGO");

  const totalCriticos = await verificarEDispararAlertaEstoque(usuario.graficaId, usuario.grafica.nome);

  const [itensCatalogo, itensGrafica] = await Promise.all([
    prisma.itemCatalogo.findMany({
      // Mestre global (graficaId=null) + itens privados criados por essa gráfica.
      where: { OR: [{ graficaId: null }, { graficaId: usuario.graficaId }] },
      orderBy: [{ tipo: "asc" }, { categoria: "asc" }, { nome: "asc" }],
    }),
    prisma.itemGrafica.findMany({
      where: { graficaId: usuario.graficaId },
      include: { variantes: { where: { ativo: true }, select: { id: true, rotulo: true } } },
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
        perdaFixaPadrao: ig.perdaFixaPadrao?.toString() ?? "",
        variantes: ig.variantes.map((v) => v.rotulo),
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
        modulosVisiveis={await obterModulosVisiveis(usuario)}
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

        <Card
          className={`mb-6 flex items-center justify-between gap-4 p-6 ${
            totalCriticos > 0
              ? "border-rose-200 bg-rose-50/60 dark:border-rose-900 dark:bg-rose-950/20"
              : ""
          }`}
        >
          <div className="flex items-center gap-3">
            {totalCriticos > 0 && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400">
                <AlertTriangleIcon className="h-5 w-5" />
              </span>
            )}
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                {totalCriticos > 0
                  ? `${totalCriticos} ${totalCriticos === 1 ? "item" : "itens"} com estoque baixo`
                  : "Previsão de estoque"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {totalCriticos > 0
                  ? "No limite ou abaixo do mínimo cadastrado — os DONOs já foram avisados por e-mail."
                  : "Veja quais matérias-primas estão previstas pra acabar em breve, calculado a partir do consumo real."}
              </p>
            </div>
          </div>
          <Link href="/catalogo/estoque">
            <Button type="button" variant={totalCriticos > 0 ? "primary" : "outline"}>
              Ver previsão
            </Button>
          </Link>
        </Card>

        {podeEditar && (
          <Card className="mb-6 flex items-center justify-between gap-4 p-6">
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Reajuste de preços em lote
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Aumente ou diminua o preço de vários produtos de uma vez, em vez
                de editar um por um. Só afeta produtos com cálculo Simples.
              </p>
            </div>
            <Link href="/catalogo/reajuste">
              <Button type="button" variant="outline">
                Reajustar preços
              </Button>
            </Link>
          </Card>
        )}

        <CatalogoForm
          itensCatalogo={itensCatalogo.map((i) => ({
            id: i.id,
            tipo: i.tipo,
            categoria: i.categoria,
            nome: i.nome,
            unidade: i.unidade,
            unidadeOutro: i.unidadeOutro,
          }))}
          selecoes={selecoesPorItem}
        />
      </main>
    </div>
  );
}
