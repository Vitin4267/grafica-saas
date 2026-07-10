import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { podeVerMeuNegocio } from "@/lib/auth/permissoes";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/Badge";
import { PrinterIcon } from "@/components/icons";
import { AvancarPedidoButton } from "./AvancarPedidoButton";

export default async function ProducaoPage() {
  const usuario = await exigirUsuarioAutenticado();

  const pedidos = await prisma.pedido.findMany({
    where: { graficaId: usuario.graficaId },
    include: {
      orcamento: {
        include: {
          cliente: true,
          itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="flex flex-1 flex-col">
      <UserNav
        nome={usuario.nome}
        graficaNome={usuario.grafica.nome}
        papel={usuario.papel}
        paginaAtual="/producao"
        mostrarMeuNegocio={podeVerMeuNegocio(usuario)}
      />

      <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Fila de produção
          </h1>
          <p className="mt-1 text-slate-500">
            Pedidos gerados a partir de orçamentos aprovados, do mais antigo
            para o mais novo.
          </p>
        </div>

        {pedidos.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-800">
              <PrinterIcon className="h-6 w-6" />
            </span>
            <p className="text-sm text-slate-500">
              Nenhum pedido em produção ainda. Aprove um orçamento para gerar
              o primeiro.
            </p>
          </Card>
        ) : (
          <Card className="divide-y divide-slate-100 dark:divide-slate-800">
            {pedidos.map((pedido) => (
              <div
                key={pedido.id}
                className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 dark:bg-teal-950 dark:text-teal-400">
                    <PrinterIcon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">
                      {pedido.orcamento.cliente.nome}
                    </p>
                    <p className="text-sm text-slate-500">
                      {pedido.orcamento.itens
                        .map((i) => i.itemGrafica.itemCatalogo.nome)
                        .join(", ")}
                    </p>
                    <Link
                      href={`/orcamento/${pedido.orcamentoId}`}
                      className="text-xs text-teal-700 hover:underline dark:text-teal-400"
                    >
                      Ver orçamento
                    </Link>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={pedido.status} tipo="pedido" />
                  <AvancarPedidoButton pedidoId={pedido.id} status={pedido.status} />
                </div>
              </div>
            ))}
          </Card>
        )}
      </main>
    </div>
  );
}
