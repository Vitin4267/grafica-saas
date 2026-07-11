import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatoMoeda } from "@/lib/moeda";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/Badge";
import { Logo } from "@/components/Logo";
import { RespostaPublica } from "./RespostaPublica";

export default async function OrcamentoPublicoPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Busca só pelo token — rota pública, sem exigirUsuarioAutenticado().
  const orcamento = await prisma.orcamento.findUnique({
    where: { linkPublicoToken: token },
    include: {
      cliente: true,
      grafica: true,
      itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
    },
  });

  if (!orcamento) {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <Logo />
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm text-slate-500">Orçamento de {orcamento.grafica.nome}</p>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {orcamento.cliente.nome}
            </h1>
          </div>
          <StatusBadge status={orcamento.status} />
        </div>

        {/* Nunca renderiza item.breakdown aqui — custo de material, margens etc.
            são dado comercial sensível da gráfica, não algo que o cliente final vê. */}
        <Card className="mb-6 divide-y divide-slate-100 dark:divide-slate-800">
          {orcamento.itens.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 p-5">
              <div className="flex items-center justify-between gap-4">
                <p className="font-medium text-slate-900 dark:text-white">
                  {item.itemGrafica.itemCatalogo.nome}
                </p>
                <p className="font-semibold text-slate-900 dark:text-white">
                  {formatoMoeda.format(Number(item.precoTotal))}
                </p>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>Qtd: {item.quantidade}</span>
                {item.larguraCm && item.alturaCm && (
                  <span>
                    {Number(item.larguraCm)} × {Number(item.alturaCm)} cm
                  </span>
                )}
                {item.cores && <span>Cores: {item.cores}</span>}
                {item.acabamento && <span>Acabamento: {item.acabamento}</span>}
                <span>Unitário: {formatoMoeda.format(Number(item.precoUnitario))}</span>
              </div>
            </div>
          ))}
        </Card>

        <Card className="mb-6 flex items-center justify-between p-5">
          <p className="text-sm font-medium text-slate-500">Total</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white">
            {formatoMoeda.format(Number(orcamento.total))}
          </p>
        </Card>

        <a href={`/o/${token}/pdf`} className="mb-6 block">
          <Button type="button" variant="outline" className="w-full">
            Baixar PDF
          </Button>
        </a>

        {orcamento.status === "ENVIADO" && <RespostaPublica token={token} />}
        {orcamento.status === "APROVADO" && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            Você aprovou este orçamento.
          </p>
        )}
        {orcamento.status === "REJEITADO" && (
          <p className="text-sm text-rose-600 dark:text-rose-400">
            Este orçamento foi recusado.
          </p>
        )}
        {orcamento.status === "RASCUNHO" && (
          <p className="text-sm text-slate-500">Aguardando confirmação da gráfica.</p>
        )}
      </main>
    </div>
  );
}
