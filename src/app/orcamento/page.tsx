import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { podeVerMeuNegocio } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { ReceiptIcon, SlidersIcon } from "@/components/icons";
import { CalculadoraForm } from "./CalculadoraForm";

export default async function OrcamentoPage() {
  const usuario = await exigirUsuarioAutenticado();

  const [itensVendaveis, clientes, orcamentosRecentes] = await Promise.all([
    prisma.itemGrafica.findMany({
      where: {
        graficaId: usuario.graficaId,
        ativo: true,
        precoVenda: { not: null },
      },
      include: { itemCatalogo: true },
      orderBy: { itemCatalogo: { nome: "asc" } },
    }),
    prisma.cliente.findMany({
      where: { graficaId: usuario.graficaId },
      orderBy: { nome: "asc" },
    }),
    prisma.orcamento.findMany({
      where: { graficaId: usuario.graficaId },
      include: {
        cliente: true,
        itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
  ]);

  const formatoMoeda = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  });

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/orcamento"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Calculadora de orçamento
          </h1>
          <p className="mt-1 text-slate-500">
            Escolha o cliente e o produto para montar o orçamento em segundos.
          </p>
        </div>

        {clientes.length === 0 || itensVendaveis.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
              <SlidersIcon className="h-6 w-6" />
            </span>
            <h2 className="font-semibold text-slate-900 dark:text-white">
              Falta pouco para o primeiro orçamento
            </h2>
            <p className="max-w-sm text-sm text-slate-500">
              Finalize a configuração inicial da sua gráfica — cadastre um
              cliente e escolha o que ela vende — para começar a orçar.
            </p>
            <Link href="/comecar">
              <Button variant="primary" className="mt-2">
                Continuar configuração
              </Button>
            </Link>
          </Card>
        ) : (
          <CalculadoraForm
            itens={itensVendaveis.map((ig) => ({
              id: ig.id,
              nome: ig.itemCatalogo.nome,
              categoria: ig.itemCatalogo.categoria,
              precoVenda: ig.precoVenda!.toString(),
              modeloCalculo: ig.modeloCalculo,
            }))}
            clientes={clientes}
          />
        )}

        <section className="mt-12">
          <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
            Orçamentos recentes
          </h2>
          {orcamentosRecentes.length === 0 ? (
            <Card className="flex flex-col items-center gap-3 p-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
                <ReceiptIcon className="h-6 w-6" />
              </span>
              <p className="text-sm text-slate-500">
                Nenhum orçamento criado ainda. Assim que você salvar o
                primeiro, ele aparece aqui.
              </p>
            </Card>
          ) : (
            <Card className="divide-y divide-slate-100 dark:divide-slate-800">
              {orcamentosRecentes.map((o) => (
                <Link
                  key={o.id}
                  href={`/orcamento/${o.id}`}
                  className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                      <ReceiptIcon className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-medium text-slate-900 dark:text-white">
                        {o.cliente.nome}
                      </p>
                      <p className="text-sm text-slate-500">
                        {o.itens.map((i) => i.itemGrafica.itemCatalogo.nome).join(", ")}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {formatoMoeda.format(Number(o.total))}
                    </p>
                    <StatusBadge status={o.status} />
                  </div>
                </Link>
              ))}
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}
