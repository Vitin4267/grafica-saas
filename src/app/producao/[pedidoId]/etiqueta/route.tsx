import { randomBytes } from "node:crypto";
import { notFound } from "next/navigation";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeEditarModulo } from "@/lib/auth/permissoes";
import { resolverOrigemPublica } from "@/lib/url-publica";
import { gerarQrCodeDataUrl } from "@/lib/qr-code";
import { slugify } from "@/lib/slug";
import { EtiquetaPedidoDocumento } from "@/lib/pdf/EtiquetaPedidoDocumento";

// Gate de EDIÇÃO (não só leitura, ao contrário de ordem-producao/route.tsx):
// esta rota pode ESCREVER pedido.qrToken na primeira vez que a etiqueta de
// um pedido é baixada (mesmo padrão de enviarArte, que também exige
// PRODUCAO.podeEditar pra gerar arteLinkToken) — um operador que só pode
// VER produção não deveria conseguir gerar/imprimir a credencial de acesso
// da tela de avanço de status.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pedidoId: string }> }
) {
  const { pedidoId } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  if (!(await podeEditarModulo(usuario, "PRODUCAO"))) {
    return new Response("Sem permissão pra editar produção.", { status: 403 });
  }

  // Mesmo escopo de tenant das outras rotas de PDF — um id de pedido de
  // outra gráfica não deve nem existir do ponto de vista dessa query.
  const pedido = await prisma.pedido.findFirst({
    where: { id: pedidoId, graficaId: usuario.graficaId },
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

  // Token evergreen gerado sob demanda — só nasce na primeira etiqueta
  // baixada pra este pedido, mesmo padrão preguiçoso de arteLinkToken
  // (enviarArte) e producaoLinkToken (avancarStatusPedido). Reaproveitado em
  // downloads seguintes: reimprimir a etiqueta nunca invalida QRs já colados
  // em produtos físicos anteriores deste mesmo pedido.
  let qrToken = pedido.qrToken;
  if (!qrToken) {
    qrToken = randomBytes(20).toString("base64url");
    await prisma.pedido.update({ where: { id: pedido.id }, data: { qrToken } });
  }

  const origem = await resolverOrigemPublica();
  const qrDataUrl = await gerarQrCodeDataUrl(`${origem}/q/${qrToken}`);

  const pedidoNumero = pedido.id.slice(0, 8);
  const itensResumo = pedido.orcamento.itens
    .map((item) => `${item.quantidade}x ${item.itemGrafica.itemCatalogo.nome}`)
    .join(", ");

  const buffer = await renderToBuffer(
    <EtiquetaPedidoDocumento
      dados={{
        graficaNome: pedido.orcamento.grafica.nome,
        pedidoNumero,
        clienteNome: pedido.orcamento.cliente.nome,
        itensResumo,
        qrDataUrl,
      }}
    />
  );

  const nomeArquivo = `etiqueta-${slugify(pedido.orcamento.cliente.nome)}-${pedidoNumero}.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
    },
  });
}
