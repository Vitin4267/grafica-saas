import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { formatoInstanteRealComHora } from "@/lib/data";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/Logo";
import { RespostaArtePublica } from "./RespostaArtePublica";
import { RespostaArteItemPublica } from "./RespostaArteItemPublica";

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
    include: {
      orcamento: {
        include: {
          cliente: true,
          grafica: true,
          // Achado F5 da auditoria de abrangência (Parte 7) — arte POR ITEM
          // (ver model ArteItem) deste MESMO pedido, aprovada pelo MESMO
          // link/token de sempre — não existe um token dedicado por item.
          // opcaoId: null (só a opção-base, mesmo filtro de orcamento/[id]/page.tsx)
          // — opção alternativa nunca chega a ter Pedido de qualquer forma
          // (só a opção promovida na aprovação sobrevive).
          itens: {
            where: { opcaoId: null, arteItem: { pedidoId: { not: null } } },
            include: { itemGrafica: { include: { itemCatalogo: true } }, arteItem: true },
          },
        },
      },
    },
  });

  // Achado F5 — item com ArteItem própria conta como "tem arte pra
  // aprovar" mesmo quando o pedido nunca teve arteUrl de cabeçalho (feature
  // opt-in independente uma da outra).
  const itensComArte = pedido?.orcamento.itens.filter((item) => item.arteItem) ?? [];

  if (!pedido || (!pedido.arteUrl && itensComArte.length === 0)) {
    notFound();
  }

  const ehPdf = pedido.arteUrl?.toLowerCase().endsWith(".pdf") ?? false;

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

        {pedido.arteUrl && (
          <>
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
              <p className="mb-6 text-sm text-emerald-600 dark:text-emerald-400">
                {pedido.arteRespondidaPor
                  ? `Aprovada por ${pedido.arteRespondidaPor} em ${formatoInstanteRealComHora.format(pedido.arteAprovadaEm)}.`
                  : "Esta arte foi aprovada."}
              </p>
            ) : (
              <div className="mb-6">
                <RespostaArtePublica token={token} nomeSugerido={pedido.orcamento.contatoNome} />
              </div>
            )}
          </>
        )}

        {/* Achado F5 — uma seção por item com arte própria enviada, cada
            uma com sua própria decisão de aprovar/pedir alteração,
            independente do bloco de cabeçalho acima (que pode nem existir —
            ver notFound acima). */}
        {itensComArte.map((item) => {
          const arte = item.arteItem!;
          const nomeItem = item.itemGrafica.itemCatalogo.nome;
          const ehPdfItem = arte.url.toLowerCase().endsWith(".pdf");
          return (
            <div key={item.id} className="mb-6">
              <p className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                Arte de: {nomeItem}
              </p>
              <Card className="mb-3 flex flex-col items-center gap-4 p-5">
                {ehPdfItem ? (
                  <a href={arte.url} target="_blank" rel="noopener noreferrer" className="w-full">
                    <Button type="button" variant="outline" className="w-full">
                      Abrir arquivo PDF
                    </Button>
                  </a>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element -- arquivo vem de URL externa (Vercel Blob), fora do domínio otimizável pelo next/image
                  <img
                    src={arte.url}
                    alt={`Arte de ${nomeItem} enviada pra aprovação`}
                    className="max-h-[70vh] w-full rounded-lg object-contain"
                  />
                )}
              </Card>

              {arte.aprovadaEm ? (
                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                  {arte.respondidaPor
                    ? `Aprovada por ${arte.respondidaPor} em ${formatoInstanteRealComHora.format(arte.aprovadaEm)}.`
                    : "Esta arte foi aprovada."}
                </p>
              ) : (
                <RespostaArteItemPublica
                  token={token}
                  arteItemId={arte.id}
                  nomeItem={nomeItem}
                  nomeSugerido={pedido.orcamento.contatoNome}
                />
              )}
            </div>
          );
        })}
      </main>
    </div>
  );
}
