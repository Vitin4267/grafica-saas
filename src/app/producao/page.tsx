import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import {
  podeVerMeuNegocio,
  podeVerModulo,
  podeEditarModulo,
  obterModulosVisiveis,
} from "@/lib/auth/permissoes";
import { verificarEDispararAlertasAtraso } from "@/lib/alerta-atraso";
import { dataEhPassado } from "@/lib/data";
import { resolverOrigemPublica } from "@/lib/url-publica";
import { UserNav } from "@/components/UserNav";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
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

  // Responsabilidades por etapa (ver ResponsavelEstagio) dão acesso a
  // /producao mesmo sem PRODUCAO.podeVer completo — precisa ler isso ANTES
  // do gate pra decidir se redireciona. DONO/ADMIN sempre passam por
  // podeVerModulo, então nunca precisam do fallback.
  const responsabilidades =
    usuario.papel === "OPERADOR"
      ? await prisma.responsavelEstagio.findMany({
          where: { usuarioId: usuario.id },
          select: { status: true },
        })
      : [];
  const etapasResponsavel = new Set(responsabilidades.map((r) => r.status));

  const podeVer = await podeVerModulo(usuario, "PRODUCAO");
  if (!podeVer && etapasResponsavel.size === 0) {
    redirect("/comecar");
  }
  const podeEditar = await podeEditarModulo(usuario, "PRODUCAO");

  await verificarEDispararAlertasAtraso(usuario.graficaId, usuario.grafica.nome);
  const origem = await resolverOrigemPublica();

  const todosPedidos = await prisma.pedido.findMany({
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

  // Quem só entrou aqui pela responsabilidade de etapa (sem PRODUCAO.podeVer
  // de verdade) não deveria ver a fila inteira — só os pedidos que estão
  // numa das etapas dele. Quem tem podeVer completo continua vendo tudo,
  // sem filtro (inclui DONO/ADMIN, que nunca dependem de etapasResponsavel).
  const pedidos = podeVer
    ? todosPedidos
    : todosPedidos.filter((pedido) => etapasResponsavel.has(pedido.status));

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
          <EmptyState
            icone={<PrinterIcon className="h-6 w-6" />}
            texto="Nenhum pedido em produção ainda. Pedidos aparecem aqui automaticamente quando um orçamento é aprovado."
            href="/orcamento"
            rotuloCta="Ir para Orçamento"
          />
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
                souResponsavelDesteStatus={etapasResponsavel.has(pedido.status)}
                chipAtraso={chipAtraso(pedido.prazoEntrega, pedido.status)}
                arteUrl={pedido.arteUrl}
                arteAprovadaEm={pedido.arteAprovadaEm}
                arteRespondidaPor={pedido.arteRespondidaPor}
                arteComentarioCliente={pedido.arteComentarioCliente}
                linkArtePublico={pedido.arteLinkToken ? `${origem}/a/${pedido.arteLinkToken}` : null}
              />
            ))}
          </Card>
        )}
      </main>
    </div>
  );
}
