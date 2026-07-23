import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/Logo";
import { RespostaArtePublica } from "./RespostaArtePublica";

export default async function ArtePublicaPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Rota pública, sem exigirUsuarioAutenticado() — mesmo padrão de
  // o/[token]/page.tsx: o token em si é a credencial.
  const pedido = await prisma.pedido.findUnique({
    where: { arteLinkToken: token },
    include: { orcamento: { include: { cliente: true, grafica: true } } },
  });

  if (!pedido || !pedido.arteUrl) {
    notFound();
  }

  const ehPdf = pedido.arteUrl.toLowerCase().endsWith(".pdf");

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950">
      <header className="border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <Logo />
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
        <div className="mb-6">
          <p className="text-sm text-slate-500">Arte do pedido de {pedido.orcamento.grafica.nome}</p>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {pedido.orcamento.cliente.nome}
          </h1>
        </div>

        <Card className="mb-6 flex flex-col items-center gap-4 p-5">
          {ehPdf ? (
            <a href={pedido.arteUrl} target="_blank" rel="noopener noreferrer" className="w-full">
              <Button type="button" variant="outline" className="w-full">
                Abrir arquivo PDF
              </Button>
            </a>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- arquivo vem de URL externa (Vercel Blob), fora do domínio otimizável pelo next/image
            <img
              src={pedido.arteUrl}
              alt="Arte enviada pra aprovação"
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          )}
        </Card>

        {pedido.arteAprovadaEm ? (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            Você aprovou esta arte.
          </p>
        ) : (
          <RespostaArtePublica token={token} />
        )}
      </main>
    </div>
  );
}
