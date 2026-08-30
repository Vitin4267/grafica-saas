import { notFound } from "next/navigation";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { exigirUsuarioAutenticado } from "@/lib/auth/session";
import { exigirAssinaturaAtiva } from "@/lib/auth/assinatura";
import { exigirEmailVerificado } from "@/lib/auth/email-verificacao";
import { podeVerModulo } from "@/lib/auth/permissoes";
import { OrcamentoDocumento } from "@/lib/pdf/OrcamentoDocumento";
import { mapearDadosPdf, nomeArquivoPdf } from "@/lib/pdf/mapear-dados";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const usuario = await exigirUsuarioAutenticado();
  await exigirEmailVerificado(usuario);
  await exigirAssinaturaAtiva(usuario);
  // Mesmo gate de módulo que a tela /orcamento/[id] e que a rota irmã
  // /financeiro/exportar já faziam — sem isto, um OPERADOR sem permissão de
  // ver ORCAMENTO era bloqueado na tela mas baixava o PDF completo (cliente,
  // itens, preço unitário e total) indo direto na URL. Os ids de orçamento
  // ficam visíveis pra ele em /producao, então não era nem preciso adivinhar.
  if (!(await podeVerModulo(usuario, "ORCAMENTO"))) {
    return new Response("Sem permissão pra ver orçamentos.", { status: 403 });
  }

  // Mesmo escopo de tenant da tela /orcamento/[id] — um id de orçamento de
  // outra gráfica não deve nem existir do ponto de vista dessa query.
  const orcamento = await prisma.orcamento.findFirst({
    where: { id, graficaId: usuario.graficaId },
    include: {
      cliente: true,
      // include (não select) pra manter os campos escalares de Grafica de
      // hoje (nome, logoUrl, corPrimaria...) — só a relação `parametros` é
      // restrita a `select`, pra nunca puxar overhead/margem/comissão (dado
      // comercial interno) pra dentro do processo que gera o PDF público.
      grafica: {
        include: {
          parametros: {
            select: { termosCondicoesPdf: true, mostrarEspecificacoesTecnicas: true, prazoEmDiasUteis: true, toleranciaTiragemPercent: true },
          },
        },
      },
      // opcaoId: null — o PDF sempre representa a opção-base ("Opção A").
      // MVP não gera PDF por opção alternativa (ver model OrcamentoOpcao no
      // schema.prisma); sem este filtro, itens de opções alternativas
      // apareceriam misturados aqui, inflando o total do PDF.
      itens: {
        where: { opcaoId: null },
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
