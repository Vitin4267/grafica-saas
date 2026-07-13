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
import { formatoMoeda } from "@/lib/moeda";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { ReceiptIcon, SlidersIcon } from "@/components/icons";
import { CalculadoraForm } from "./CalculadoraForm";
import { MarcarEnviadoButton } from "./MarcarEnviadoButton";

export default async function OrcamentoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "ORCAMENTO");
  const podeEditar = await podeEditarModulo(usuario, "ORCAMENTO");

  const [itensVendaveis, clientes, filiais, orcamentosRecentes] = await Promise.all([
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
    // Só usado pra decidir se o campo "Filial" aparece no formulário — sem
    // nenhuma cadastrada, o campo nem existe (gráfica sem filial não vê nada
    // diferente, ver CalculadoraForm.tsx).
    prisma.filial.findMany({
      where: { graficaId: usuario.graficaId, ativa: true },
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

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/orcamento"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
        modulosVisiveis={await obterModulosVisiveis(usuario)}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {podeEditar ? "Calculadora de orçamento" : "Orçamentos"}
          </h1>
          <p className="mt-1 text-slate-500">
            {podeEditar
              ? "Escolha o cliente e o produto para montar o orçamento em segundos."
              : "Acompanhe os orçamentos da gráfica."}
          </p>
        </div>

        {!podeEditar ? null : clientes.length === 0 || itensVendaveis.length === 0 ? (
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
            filiais={filiais}
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
                <div
                  key={o.id}
                  className="flex flex-col gap-3 p-5 transition-colors hover:bg-slate-50 sm:flex-row sm:items-center sm:justify-between dark:hover:bg-slate-800/50"
                >
                  <Link href={`/orcamento/${o.id}`} className="flex flex-1 items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                      <ReceiptIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 dark:text-white">
                        {o.cliente.nome}
                      </p>
                      <p className="truncate text-sm text-slate-500">
                        {o.itens.map((i) => i.itemGrafica.itemCatalogo.nome).join(", ")}
                      </p>
                    </div>
                  </Link>
                  <div className="flex items-center justify-between gap-3 sm:justify-end sm:gap-4">
                    {podeEditar && o.status === "RASCUNHO" && (
                      <MarcarEnviadoButton orcamentoId={o.id} />
                    )}
                    <Link href={`/orcamento/${o.id}`} className="flex flex-col items-end gap-1.5">
                      <p className="font-semibold text-slate-900 dark:text-white">
                        {formatoMoeda.format(Number(o.total))}
                      </p>
                      <StatusBadge status={o.status} />
                    </Link>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}
