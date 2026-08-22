import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/Logo";
import {
  ROTULOS_STATUS_PEDIDO,
  ESTAGIOS_ATRIBUIVEIS,
  SEQUENCIA_STATUS_PEDIDO,
} from "@/lib/producao-estagios";
import { AvancarStatusQr } from "./AvancarStatusQr";

// Rota pública, sem exigirUsuarioAutenticado() — mesmo padrão de
// p/[token]/page.tsx e o/[token]/page.tsx: o token em si é a credencial.
// Mobile-first de propósito (ver comentário de Pedido.qrToken no schema):
// tela pensada pra abrir no celular do operador ao escanear a etiqueta
// física colada no produto, não no desktop.
export default async function EtiquetaPedidoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const pedido = await prisma.pedido.findUnique({
    where: { qrToken: token },
    include: {
      orcamento: {
        include: {
          cliente: true,
          grafica: true,
          itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
        },
      },
    },
  });

  if (!pedido) {
    notFound();
  }

  // Só as etapas atribuíveis têm avanço de verdade por aqui (ver
  // ESTAGIOS_ATRIBUIVEIS) — FILA fica de fora de propósito (a transição que
  // baixa estoque exige a tela de confirmação de perda de material, que não
  // existe nesta versão mobile), e ENTREGUE/CANCELADO são terminais.
  const confirmavel = ESTAGIOS_ATRIBUIVEIS.some((estagio) => estagio.valor === pedido.status);
  const indiceAtual = SEQUENCIA_STATUS_PEDIDO.indexOf(pedido.status);
  const proximoStatus =
    confirmavel && indiceAtual !== -1 ? SEQUENCIA_STATUS_PEDIDO[indiceAtual + 1] : null;

  const itensResumo = pedido.orcamento.itens
    .map((item) => `${item.quantidade}x ${item.itemGrafica.itemCatalogo.nome}`)
    .join(", ");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <Logo />
      </header>

      <main className="mx-auto w-full max-w-md flex-1 px-4 py-8">
        <div className="mb-6">
          <p className="text-sm text-slate-500">{pedido.orcamento.grafica.nome}</p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            Pedido #{pedido.id.slice(0, 8)}
          </h1>
        </div>

        <Card className="flex flex-col gap-5 p-5">
          <div>
            <p className="text-sm text-slate-500">Cliente</p>
            <p className="text-lg font-semibold text-slate-900 dark:text-white">
              {pedido.orcamento.cliente.nome}
            </p>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{itensResumo}</p>
          </div>

          <div>
            <p className="text-sm text-slate-500">Etapa atual</p>
            <p className="text-xl font-bold text-slate-900 dark:text-white">
              {ROTULOS_STATUS_PEDIDO[pedido.status]}
            </p>
          </div>

          {confirmavel && proximoStatus ? (
            <AvancarStatusQr token={token} rotuloProximaEtapa={ROTULOS_STATUS_PEDIDO[proximoStatus]} />
          ) : (
            <p className="text-sm text-slate-500">Nada pra avançar por aqui agora.</p>
          )}
        </Card>
      </main>
    </div>
  );
}
