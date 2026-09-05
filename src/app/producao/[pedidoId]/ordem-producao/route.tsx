import { notFound } from "next/navigation";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerModulo } from "@/lib/auth/permissoes";
import { resolverEtapasGrafica } from "@/lib/etapa-grafica";
import { OrdemProducaoDocumento } from "@/lib/pdf/OrdemProducaoDocumento";
import { mapearDadosOrdemProducao, nomeArquivoOrdemProducao } from "@/lib/pdf/mapear-dados-ordem-producao";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ pedidoId: string }> }
) {
  const { pedidoId } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  // Mesmo gate de módulo que a tela /producao já exige pra visão completa
  // (ver ProducaoPage) — documento interno, então não é vazamento de dado
  // pro cliente, mas ainda assim escopado a quem pode ver PRODUCAO.
  if (!(await podeVerModulo(usuario, "PRODUCAO"))) {
    return new Response("Sem permissão pra ver produção.", { status: 403 });
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
          itens: {
            include: {
              itemGrafica: {
                include: {
                  itemCatalogo: true,
                  fichaTecnica: {
                    include: {
                      materiaPrima: { include: { itemCatalogo: true } },
                      variante: true,
                    },
                  },
                },
              },
              etiqueta: { include: { hotStampings: true } },
              acabamentos: {
                include: {
                  itemGrafica: {
                    include: {
                      itemCatalogo: true,
                      fichaTecnica: {
                        include: {
                          materiaPrima: { include: { itemCatalogo: true } },
                          variante: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!pedido) {
    notFound();
  }

  // Achado A2 da auditoria de abrangência (Parte 2, seção A) — rótulo do
  // estágio RESOLVIDO por gráfica (ex: CLICHE_FACA vira "Pré-impressão" por
  // padrão, ou o nome que a gráfica customizou em EtapaGrafica), não o nome
  // genérico do sistema. Mesma fonte que /producao, /p/[token] e /q/[token]
  // já usam.
  const etapas = await resolverEtapasGrafica(usuario.graficaId);

  const buffer = await renderToBuffer(
    <OrdemProducaoDocumento
      dados={mapearDadosOrdemProducao(pedido, etapas.rotulos[pedido.status])}
    />
  );
  const nomeArquivo = nomeArquivoOrdemProducao(pedido.orcamento.cliente.nome, pedido.id);

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomeArquivo}"`,
    },
  });
}
