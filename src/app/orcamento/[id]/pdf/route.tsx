import { notFound } from "next/navigation";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { OrcamentoDocumento } from "@/lib/pdf/OrcamentoDocumento";
import { mapearDadosPdf, nomeArquivoPdf } from "@/lib/pdf/mapear-dados";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirAssinaturaAtiva(usuario);

  // Mesmo escopo de tenant da tela /orcamento/[id] — um id de orçamento de
  // outra gráfica não deve nem existir do ponto de vista dessa query.
  const orcamento = await prisma.orcamento.findFirst({
    where: { id, graficaId: usuario.graficaId },
    include: {
      cliente: true,
      grafica: true,
      itens: { include: { itemGrafica: { include: { itemCatalogo: true } } } },
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
