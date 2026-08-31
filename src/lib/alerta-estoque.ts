import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { dispararEventoEmail } from "@/lib/email/webhook-email";
import { templateEstoqueBaixo, type ItemEstoqueBaixo } from "@/lib/email/templates";
import { estoqueEstaCritico } from "@/lib/estoque-critico";

// Roda sob demanda (não é cron) a cada carregamento de /catalogo — mesma
// filosofia de verificarEDispararAlertasAtraso (src/lib/alerta-atraso.ts).
// Self-healing: ao contrário do webhook estoque_critico (que dispara só na
// TRANSIÇÃO de uma baixa de produção específica, ver avancarPedido), este
// compara um snapshot do estoque agora contra o dedup já registrado — cobre
// qualquer causa (produção, edição manual em /catalogo, estorno incompleto)
// e volta a alertar se o estoque subir acima do mínimo e cair de novo depois.
//
// Retorna quantos itens estão críticos AGORA (não só os novos) — a página
// usa esse número pro aviso visual, sem precisar de uma segunda consulta.
//
// DESTINATÁRIOS (achado A9 da auditoria de abrangência, restante pendente,
// 2026-08-31): mesmo mecanismo de ResponsavelAdministrativo já usado por
// enviarAlertasPrazoEmail (src/lib/alerta-prazo-email.ts) pra PRAZO_PRODUCAO,
// agora com a área COMPRAS — ver o bloco perto do fim da função.
export async function verificarEDispararAlertaEstoque(
  graficaId: string,
  graficaNome: string
): Promise<number> {
  const [itens, variantes] = await Promise.all([
    prisma.itemGrafica.findMany({
      where: {
        graficaId,
        ativo: true,
        estoqueMinimo: { not: null },
        variantes: { none: { ativo: true } }, // pula o pai quando há variante — mesmo raciocínio de previsao-estoque-db.ts
      },
      include: { itemCatalogo: true },
    }),
    prisma.varianteMateriaPrima.findMany({
      where: {
        ativo: true,
        estoqueMinimo: { not: null },
        itemGrafica: { graficaId, ativo: true },
      },
      include: { itemGrafica: { include: { itemCatalogo: true } } },
    }),
  ]);

  const novosCriticos: ItemEstoqueBaixo[] = [];
  let totalCriticos = 0;

  for (const item of itens) {
    const estoqueAtual = item.estoqueAtual === null ? null : Number(item.estoqueAtual);
    const estoqueMinimo = item.estoqueMinimo === null ? null : Number(item.estoqueMinimo);
    const critico = estoqueEstaCritico(estoqueAtual, estoqueMinimo);

    if (critico) totalCriticos += 1;

    if (critico && !item.alertaEstoqueEnviadoEm) {
      novosCriticos.push({
        nome: item.itemCatalogo.nome,
        estoqueAtual: estoqueAtual!,
        estoqueMinimo: estoqueMinimo!,
        unidade: item.itemCatalogo.unidade ?? "",
      });
      await prisma.itemGrafica.update({
        where: { id: item.id },
        data: { alertaEstoqueEnviadoEm: new Date() },
      });
    } else if (!critico && item.alertaEstoqueEnviadoEm) {
      await prisma.itemGrafica.update({
        where: { id: item.id },
        data: { alertaEstoqueEnviadoEm: null },
      });
    }
  }

  for (const variante of variantes) {
    const estoqueAtual = variante.estoqueAtual === null ? null : Number(variante.estoqueAtual);
    const estoqueMinimo = variante.estoqueMinimo === null ? null : Number(variante.estoqueMinimo);
    const critico = estoqueEstaCritico(estoqueAtual, estoqueMinimo);

    if (critico) totalCriticos += 1;

    if (critico && !variante.alertaEstoqueEnviadoEm) {
      novosCriticos.push({
        nome: `${variante.itemGrafica.itemCatalogo.nome} — ${variante.rotulo}`,
        estoqueAtual: estoqueAtual!,
        estoqueMinimo: estoqueMinimo!,
        unidade: variante.itemGrafica.itemCatalogo.unidade ?? "",
      });
      await prisma.varianteMateriaPrima.update({
        where: { id: variante.id },
        data: { alertaEstoqueEnviadoEm: new Date() },
      });
    } else if (!critico && variante.alertaEstoqueEnviadoEm) {
      await prisma.varianteMateriaPrima.update({
        where: { id: variante.id },
        data: { alertaEstoqueEnviadoEm: null },
      });
    }
  }

  if (novosCriticos.length > 0) {
    // Destinatários (achado A9 da auditoria de abrangência, restante
    // pendente, 2026-08-31): mesmo mecanismo/fallback já usado por
    // enviarAlertasPrazoEmail (src/lib/alerta-prazo-email.ts) pra
    // PRAZO_PRODUCAO — se a gráfica tem pelo menos 1 responsável
    // configurado em /usuarios pra COMPRAS, o alerta vai só pra ele(s); se
    // nunca configurou nenhum, cai no fallback de sempre (todo DONO da
    // gráfica) — zero regressão pra quem nunca mexeu em /usuarios.
    const responsaveisCompras = await prisma.responsavelAdministrativo.findMany({
      where: { area: "COMPRAS", usuario: { graficaId, desativadoEm: null } },
      select: { usuario: { select: { email: true } } },
    });
    const destinatarios =
      responsaveisCompras.length > 0
        ? responsaveisCompras.map((r) => r.usuario.email)
        : (await prisma.usuario.findMany({ where: { graficaId, papel: "DONO" }, select: { email: true } })).map(
            (dono) => dono.email
          );
    const { assunto, html, texto } = templateEstoqueBaixo(graficaNome, novosCriticos);
    for (const destinatario of destinatarios) {
      // after() em vez de void: garante que a instância serverless continua
      // viva até o e-mail terminar, mesmo depois da resposta (render da
      // página /catalogo) já ter sido enviada ao cliente.
      after(() => dispararEventoEmail({ tipo: "estoque_baixo", destinatario, assunto, html, texto }));
    }
  }

  return totalCriticos;
}
