import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Logo } from "@/components/Logo";
import { ROTULOS_STATUS_PEDIDO, ESTAGIOS_ATRIBUIVEIS } from "@/lib/producao-estagios";
import { ConfirmarEstagioPublico } from "./ConfirmarEstagioPublico";

export default async function ConfirmarEstagioPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Rota pública, sem exigirUsuarioAutenticado() — mesmo padrão de
  // a/[token]/page.tsx e o/[token]/page.tsx: o token em si é a credencial.
  // Link evergreen: o TOKEN não expira nem fica travado num estado antigo
  // depois de uma confirmação, então cada carregamento desta página sempre
  // lê o status ATUAL do pedido. Mas o status lido AQUI é gravado como
  // "etapaEsperada" no form abaixo, e a action confere de novo antes de
  // avançar — isso trava um e-mail antigo (aberto depois que o pedido já
  // passou daquela etapa) de empurrar o pedido a partir do status atual sem
  // intenção (ver confirmarEstagioPublico em ./actions.ts).
  const pedido = await prisma.pedido.findUnique({
    where: { producaoLinkToken: token },
    include: { orcamento: { include: { cliente: true, grafica: true } } },
  });

  if (!pedido) {
    notFound();
  }

  // Só as etapas atribuíveis têm uma confirmação de verdade pra fazer aqui
  // (ver ESTAGIOS_ATRIBUIVEIS) — ARTE e CLICHE_FACA ficam de fora de
  // propósito (CLICHE_FACA é a transição que baixa estoque e exige a tela
  // de confirmação de perda de material, não dá pra fazer isso num link sem
  // login), e ENTREGUE/CANCELADO são terminais.
  const confirmavel = ESTAGIOS_ATRIBUIVEIS.some((estagio) => estagio.valor === pedido.status);

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <Logo />
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <div className="mb-6">
          <p className="text-sm text-slate-500">Pedido de {pedido.orcamento.cliente.nome}</p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {pedido.orcamento.grafica.nome}
          </h1>
        </div>

        <Card className="flex flex-col gap-4 p-5">
          <div>
            <p className="text-sm text-slate-500">Etapa atual</p>
            <p className="text-xl font-bold text-slate-900 dark:text-white">
              {ROTULOS_STATUS_PEDIDO[pedido.status]}
            </p>
          </div>

          {confirmavel ? (
            <ConfirmarEstagioPublico
              token={token}
              rotuloEtapa={ROTULOS_STATUS_PEDIDO[pedido.status]}
              etapaEsperada={pedido.status}
            />
          ) : (
            <p className="text-sm text-slate-500">
              Nada pra confirmar por aqui agora.
            </p>
          )}
        </Card>
      </main>
    </div>
  );
}
