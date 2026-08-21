import { notFound } from "next/navigation";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { OrcamentoDocumento } from "@/lib/pdf/OrcamentoDocumento";
import { mapearDadosPdf, nomeArquivoPdf } from "@/lib/pdf/mapear-dados";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Rota pública, sem exigirUsuarioAutenticado() — mesmo padrão de
  // o/[token]/page.tsx: o token em si é a credencial.
  const orcamento = await prisma.orcamento.findUnique({
    where: { linkPublicoToken: token },
    include: {
      cliente: true,
      // include (não select) pra manter os campos escalares de Grafica de
      // hoje (nome, logoUrl, corPrimaria...) — só a relação `parametros` é
      // restrita a `select`, pra nunca puxar overhead/margem/comissão (dado
      // comercial interno) pra dentro do processo que gera o PDF público.
      grafica: { include: { parametros: { select: { termosCondicoesPdf: true } } } },
      itens: {
        include: {
          itemGrafica: { include: { itemCatalogo: true } },
          etiqueta: { include: { hotStampings: true } },
          acabamentos: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
        },
      },
    },
  });

  if (!orcamento) {
    notFound();
  }

  const buffer = await renderToBuffer(
    <OrcamentoDocumento dados={mapearDadosPdf(orcamento)} />
  );
  const nomeArquivo = nomeArquivoPdf(orcamento.cliente.nome, orcamento.id);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
    },
  });
}
