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
import { verificarEDispararAlertasAtraso } from "@/lib/alerta-atraso";
import { dataEhPassado } from "@/lib/data";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { PrinterIcon } from "@/components/icons";
import { PedidoLinha } from "./PedidoLinha";

function chipAtraso(prazoEntrega: Date | null, status: string) {
  if (
    !prazoEntrega ||
    status === "ENTREGUE" ||
    status === "CANCELADO" ||
    !dataEhPassado(prazoEntrega)
  ) {
    return null;
  }

  const hojeUTC = new Date();
  hojeUTC.setUTCHours(0, 0, 0, 0);
  const diasAtraso = Math.floor((hojeUTC.getTime() - prazoEntrega.getTime()) / 86_400_000);
  return (
    <span className="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700 dark:bg-rose-950/50 dark:text-rose-300">
      Atrasado ({diasAtraso}d)
    </span>
  );
}

export default async function ProducaoPage() {
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  await exigirVerModulo(usuario, "PRODUCAO");
  const podeEditar = await podeEditarModulo(usuario, "PRODUCAO");

  await verificarEDispararAlertasAtraso(usuario.graficaId, usuario.grafica.nome);

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
        modulosVisiveis={await obterModulosVisiveis(usuario)}
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
              <PedidoLinha
                key={pedido.id}
                pedidoId={pedido.id}
                orcamentoId={pedido.orcamentoId}
                clienteNome={pedido.orcamento.cliente.nome}
                itensResumo={pedido.orcamento.itens
                  .map((i) => i.itemGrafica.itemCatalogo.nome)
                  .join(", ")}
                status={pedido.status}
                podeEditar={podeEditar}
                chipAtraso={chipAtraso(pedido.prazoEntrega, pedido.status)}
              />
            ))}
          </Card>
        )}
      </main>
    </div>
  );
}
