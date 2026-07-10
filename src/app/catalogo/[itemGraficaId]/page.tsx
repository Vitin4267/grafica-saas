import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { ArrowLeftIcon } from "@/components/icons";
import { ConfiguracaoProdutoForm } from "./ConfiguracaoProdutoForm";
import { ConfiguracaoAcabamentoForm } from "./ConfiguracaoAcabamentoForm";
import { FichaTecnicaForm } from "./FichaTecnicaForm";

export default async function ConfiguracaoItemPage({
  params,
}: {
  params: Promise<{ itemGraficaId: string }>;
}) {
  const { itemGraficaId } = await params;
  const usuario = await exigirUsuarioAutenticado();

  const [itemGrafica, materiasPrimas] = await Promise.all([
    prisma.itemGrafica.findFirst({
      where: { id: itemGraficaId, graficaId: usuario.graficaId },
      include: {
        itemCatalogo: true,
        bobinas: { orderBy: { larguraNominal: "asc" } },
        formatosFolha: { orderBy: { nome: "asc" } },
        configuracaoAcabamento: true,
        fichaTecnica: true,
      },
    }),
    prisma.itemGrafica.findMany({
      where: {
        graficaId: usuario.graficaId,
        ativo: true,
        itemCatalogo: { tipo: "MATERIA_PRIMA" },
      },
      include: { itemCatalogo: true },
      orderBy: { itemCatalogo: { nome: "asc" } },
    }),
  ]);

  if (!itemGrafica || itemGrafica.itemCatalogo.tipo === "MATERIA_PRIMA") {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* TODO(review): falta mostrarMeuNegocio={podeVerMeuNegocio(usuario)} — sem
          isso o link "Meu Negócio" some do menu nesta página pra quem tem acesso.
          Ver TODO em src/components/UserNav.tsx. */}
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/catalogo"
      />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
        <Link
          href="/catalogo"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          Voltar ao catálogo
        </Link>

        <div className="mb-8">
          <p className="text-sm font-medium text-teal-700 dark:text-teal-400">
            {itemGrafica.itemCatalogo.categoria}
          </p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {itemGrafica.itemCatalogo.nome}
          </h1>
          <p className="mt-1 text-slate-500">
            Configuração avançada de cálculo. Preço de compra e venda
            continuam editáveis em{" "}
            <Link href="/catalogo" className="underline">
              Catálogo
            </Link>
            .
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Card className="p-4">
            <p className="text-xs text-slate-500">Preço de compra</p>
            <p className="font-semibold text-slate-900 dark:text-white">
              {itemGrafica.precoCompra
                ? `R$ ${Number(itemGrafica.precoCompra).toFixed(2)}`
                : "—"}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-slate-500">Preço de venda</p>
            <p className="font-semibold text-slate-900 dark:text-white">
              {itemGrafica.precoVenda
                ? `R$ ${Number(itemGrafica.precoVenda).toFixed(2)}`
                : "—"}
            </p>
          </Card>
        </div>

        {itemGrafica.itemCatalogo.tipo === "PRODUTO" ? (
          <div className="flex flex-col gap-6">
            <ConfiguracaoProdutoForm
              itemGraficaId={itemGrafica.id}
              modeloCalculo={itemGrafica.modeloCalculo}
              viraFolha={itemGrafica.viraFolha}
              custoImpressaoM2={itemGrafica.custoImpressaoM2?.toString() ?? ""}
              areaMinimaFaturavel={itemGrafica.areaMinimaFaturavel?.toString() ?? ""}
              gramaturaGm2={itemGrafica.gramaturaGm2?.toString() ?? ""}
              precoPorKg={itemGrafica.precoPorKg?.toString() ?? ""}
              bobinas={itemGrafica.bobinas.map((b) => ({
                larguraNominal: b.larguraNominal.toString(),
                refile: b.refile.toString(),
              }))}
              formatosFolha={itemGrafica.formatosFolha.map((f) => ({
                nome: f.nome,
                larguraFolha: f.larguraFolha.toString(),
                alturaFolha: f.alturaFolha.toString(),
              }))}
            />
            <FichaTecnicaForm
              itemGraficaId={itemGrafica.id}
              materiasPrimas={materiasPrimas.map((m) => ({
                id: m.id,
                nome: m.itemCatalogo.nome,
                unidade: m.itemCatalogo.unidade,
              }))}
              fichaAtual={itemGrafica.fichaTecnica.map((f) => ({
                materiaPrimaId: f.materiaPrimaId,
                quantidadePorUnidade: f.quantidadePorUnidade.toString(),
              }))}
            />
          </div>
        ) : (
          <ConfiguracaoAcabamentoForm
            itemGraficaId={itemGrafica.id}
            precoCompra={itemGrafica.precoCompra?.toString() ?? ""}
            configuracao={
              itemGrafica.configuracaoAcabamento
                ? {
                    baseCobranca: itemGrafica.configuracaoAcabamento.baseCobranca,
                    estagio: itemGrafica.configuracaoAcabamento.estagio,
                    custoSetup: itemGrafica.configuracaoAcabamento.custoSetup.toString(),
                    custoMinimo: itemGrafica.configuracaoAcabamento.custoMinimo.toString(),
                    custoFerramental:
                      itemGrafica.configuracaoAcabamento.custoFerramental?.toString() ?? "",
                  }
                : null
            }
          />
        )}
      </main>
    </div>
  );
}
